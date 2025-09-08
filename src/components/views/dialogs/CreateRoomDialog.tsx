/*
Copyright 2024 New Vector Ltd.
Copyright 2020, 2021 The Matrix.org Foundation C.I.C.
Copyright 2017 Michael Telatynski <7t3chguy@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ChangeEvent, createRef, type KeyboardEvent, type SyntheticEvent } from "react";
import { type Room, RoomType, JoinRule, Preset, Visibility } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../../SdkConfig";
import withValidation, { type IFieldState, type IValidationResult } from "../elements/Validation";
import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { checkUserIsAllowedToChangeEncryption, type IOpts } from "../../../createRoom";
import SpaceStore from "../../../stores/spaces/SpaceStore";
import Field from "../elements/Field";
import RoomAliasField from "../elements/RoomAliasField";
import LabelledToggleSwitch from "../elements/LabelledToggleSwitch";
import DialogButtons from "../elements/DialogButtons";
import BaseDialog from "../dialogs/BaseDialog";
import JoinRuleDropdown from "../elements/JoinRuleDropdown";
import AccessibleButton from "../elements/AccessibleButton";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { privateShouldBeEncrypted } from "../../../utils/rooms";
import SettingsStore from "../../../settings/SettingsStore";
import LabelledCheckbox from "../elements/LabelledCheckbox";
import { canCreateAgenda } from "../../../utils/govTokenUtils";
import Modal from "../../../Modal";
import ErrorDialog from "../dialogs/ErrorDialog";
import TokenCheckDialog from "./TokenCheckDialog";

interface IProps {
    type?: RoomType;
    defaultPublic?: boolean;
    defaultName?: string;
    parentSpace?: Room;
    defaultEncrypted?: boolean;
    onFinished(proceed?: false): void;
    onFinished(proceed: true, opts: IOpts): void;
}

interface IState {
    /**
     * The selected room join rule.
     */
    joinRule: JoinRule;
    /**
     * Indicates whether the created room should have public visibility (ie, it should be
     * shown in the public room list). Only applicable if `joinRule` == `JoinRule.Knock`.
     */
    isPublicKnockRoom: boolean;
    /**
     * Indicates whether end-to-end encryption is enabled for the room.
     */
    isEncrypted: boolean;
    /**
     * The room name.
     */
    name: string;
    /**
     * The room topic.
     */
    topic: string;
    /**
     * The room alias.
     */
    alias: string;
    /**
     * Indicates whether the details section is open.
     */
    detailsOpen: boolean;
    /**
     * Indicates whether federation is disabled for the room.
     */
    noFederate: boolean;
    /**
     * Indicates whether the room name is valid.
     */
    nameIsValid: boolean;
    /**
     * Indicates whether the user can change encryption settings for the room.
     */
    canChangeEncryption: boolean;
    /**
     * The contribution value for DCA rooms.
     */
    contributionValue: string;
    /**
     * The room avatar file for GOV proposals.
     */
    avatar?: File;
    /**
     * The agenda type for GOV space: 'proposal' or 'discussion'
     */
    agendaType: 'proposal' | 'discussion';
    /**
     * Images embedded in the description for GOV spaces
     */
    embeddedImages: Array<{id: string, file: File, url: string}>;
    /**
     * Voting system configuration for GOV proposals
     */
    votingSystem: {
        choices: string[];
        duration: number; // Duration in days (3-14)
    };
}

export default class CreateRoomDialog extends React.Component<IProps, IState> {
    private readonly askToJoinEnabled: boolean;
    private readonly supportsRestricted: boolean;
    private nameField = createRef<Field>();
    private aliasField = createRef<RoomAliasField>();

    public constructor(props: IProps) {
        super(props);

        this.askToJoinEnabled = SettingsStore.getValue("feature_ask_to_join");
        this.supportsRestricted = !!this.props.parentSpace;

        let joinRule = JoinRule.Invite;
        if (this.props.defaultPublic && this.props.parentSpace?.name !== "GOV") {
            // GOV space proposals should always be restricted/private, not public
            joinRule = JoinRule.Public;
        } else if (this.supportsRestricted) {
            joinRule = JoinRule.Restricted;
        }

        const cli = MatrixClientPeg.safeGet();
        this.state = {
            isPublicKnockRoom: this.props.defaultPublic || false,
            isEncrypted: this.props.defaultEncrypted ?? privateShouldBeEncrypted(cli),
            joinRule,
            name: this.props.defaultName || "",
            topic: "",
            alias: "",
            detailsOpen: false,
            noFederate: SdkConfig.get().default_federate === false,
            nameIsValid: false,
            canChangeEncryption: false,
            contributionValue: "",
            avatar: undefined,
            agendaType: 'proposal',
            embeddedImages: [],
            votingSystem: {
                choices: ['For', 'Against or Abstain'],
                duration: 7 // Default 7 days
            },
        };
    }

    private roomCreateOptions(): IOpts {
        console.log("Creating room options for GOV space:", this.isGOVSpace());
        console.log("Current state:", {
            name: this.state.name,
            topic: this.state.topic,
            agendaType: this.state.agendaType,
            parentSpace: this.props.parentSpace?.name
        });
        
        const opts: IOpts = {};
        const createOpts: IOpts["createOpts"] = (opts.createOpts = {});
        opts.roomType = this.props.type;
        
        // Add numbering/prefix for GOV space
        if (this.isGOVSpace()) {
            if (this.state.agendaType === 'proposal') {
                const proposalNumber = this.getNextProposalNumber();
                createOpts.name = `Proposal #${proposalNumber}: ${this.state.name}`;
            } else {
                // Discussion type - no numbering
                createOpts.name = `Discussion: ${this.state.name}`;
            }
        } else if (this.isDCASpace()) {
            // Add DCA prefix for DCA space
            createOpts.name = `DCA: ${this.state.name}`;
        } else {
            createOpts.name = this.state.name;
        }

        if (this.state.joinRule === JoinRule.Public) {
            createOpts.visibility = Visibility.Public;
            createOpts.preset = Preset.PublicChat;
            opts.guestAccess = false;
            const { alias } = this.state;
            createOpts.room_alias_name = alias.substring(1, alias.indexOf(":"));
        } else {
            opts.encryption = this.state.isEncrypted;
        }

        if (this.state.topic) {
            if (this.isDCASpace() && this.state.contributionValue) {
                createOpts.topic = `${this.state.topic}\n\nContribution Value: ${this.state.contributionValue}`;
            } else if (this.isGOVSpace()) {
                // For GOV space, truncate description to 150 characters for room topic
                const truncatedTopic = this.state.topic.length > 150 
                    ? this.state.topic.substring(0, 150) + "..."
                    : this.state.topic;
                createOpts.topic = truncatedTopic;
            } else {
                createOpts.topic = this.state.topic;
            }
        } else if (this.isDCASpace() && this.state.contributionValue) {
            createOpts.topic = `Contribution Value: ${this.state.contributionValue}`;
        }
        if (this.state.noFederate) {
            createOpts.creation_content = { "m.federate": false };
        }

        opts.parentSpace = this.props.parentSpace;
        if (this.props.parentSpace && this.state.joinRule === JoinRule.Restricted) {
            opts.joinRule = JoinRule.Restricted;
        }

        if (this.state.joinRule === JoinRule.Knock) {
            opts.joinRule = JoinRule.Knock;
            createOpts.visibility = this.state.isPublicKnockRoom ? Visibility.Public : Visibility.Private;
        }

        // Add GOV space agenda information for post-creation processing
        if (this.isGOVSpace()) {
            (opts as any).govAgenda = {
                name: this.state.name,
                fullDescription: this.state.topic,
                type: this.state.agendaType, // 'proposal' or 'discussion'
                embeddedImages: this.state.embeddedImages, // Include embedded images
                votingSystem: this.state.agendaType === 'proposal' ? this.state.votingSystem : undefined, // Only for proposals
            };
            
            // Set avatar if provided
            if (this.state.avatar) {
                opts.avatar = this.state.avatar;
            }
        }

        return opts;
    }

    public componentDidMount(): void {
        const cli = MatrixClientPeg.safeGet();
        checkUserIsAllowedToChangeEncryption(cli, Preset.PrivateChat).then(({ allowChange, forcedValue }) =>
            this.setState((state) => ({
                canChangeEncryption: allowChange,
                // override with forcedValue if it is set
                isEncrypted: forcedValue ?? state.isEncrypted,
            })),
        );

        // move focus to first field when showing dialog
        this.nameField.current?.focus();
    }

    private onKeyDown = (event: KeyboardEvent): void => {
        const action = getKeyBindingsManager().getAccessibilityAction(event);
        switch (action) {
            case KeyBindingAction.Enter:
                this.onOk();
                event.preventDefault();
                event.stopPropagation();
                break;
        }
    };

    private onOk = async (): Promise<void> => {
        if (!this.nameField.current) return;
        const activeElement = document.activeElement as HTMLElement;
        activeElement?.blur();
        await this.nameField.current.validate({ allowEmpty: false });
        if (this.aliasField.current) {
            await this.aliasField.current.validate({ allowEmpty: false });
        }
        
        // B token check is now handled in showCreateNewRoom before opening this dialog
        
        // After B token check (if applicable), proceed with normal validation
        // Re-validate name field after B token check
        if (this.nameField.current) {
            await this.nameField.current.validate({ allowEmpty: false });
        }
        if (this.aliasField.current) {
            await this.aliasField.current.validate({ allowEmpty: false });
        }
        
        // Validation and state updates are async, so we need to wait for them to complete
        // first. Queue a `setState` callback and wait for it to resolve.
        await new Promise<void>((resolve) => this.setState({}, resolve));
        
        console.log("Final validation state:", {
            nameIsValid: this.state.nameIsValid,
            aliasValid: this.aliasField.current ? this.aliasField.current.isValid : true,
            name: this.state.name,
            topic: this.state.topic,
            agendaType: this.state.agendaType
        });
        
        if (this.state.nameIsValid && (!this.aliasField.current || this.aliasField.current.isValid)) {
            console.log("All validations passed, creating room");
            console.log("Room create options:", this.roomCreateOptions());
            try {
                this.props.onFinished(true, this.roomCreateOptions());
                console.log("onFinished called successfully");
            } catch (error) {
                console.error("Error calling onFinished:", error);
            }
        } else {
            console.log("Validation failed, showing field errors");
            console.log("Name field validation:", this.nameField.current?.isValid);
            console.log("Alias field validation:", this.aliasField.current?.isValid);
            let field: RoomAliasField | Field | null = null;
            if (!this.state.nameIsValid) {
                field = this.nameField.current;
                console.log("Name field is invalid, focusing on it");
            } else if (this.aliasField.current && !this.aliasField.current.isValid) {
                field = this.aliasField.current;
                console.log("Alias field is invalid, focusing on it");
            }
            if (field) {
                field.focus();
                await field.validate({ allowEmpty: false, focused: true });
            }
        }
    };

    private onCancel = (): void => {
        this.props.onFinished(false);
    };

    private onNameChange = (ev: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ name: ev.target.value });
    };

    private onTopicChange = (ev: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ topic: ev.target.value });
    };

    private onContributionValueChange = (ev: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ contributionValue: ev.target.value });
    };

    private onJoinRuleChange = (joinRule: JoinRule): void => {
        this.setState({ joinRule });
    };

    private onEncryptedChange = (isEncrypted: boolean): void => {
        this.setState({ isEncrypted });
    };

    private onAliasChange = (alias: string): void => {
        this.setState({ alias });
    };

    private onDetailsToggled = (ev: SyntheticEvent<HTMLDetailsElement>): void => {
        this.setState({ detailsOpen: (ev.target as HTMLDetailsElement).open });
    };

    private onNoFederateChange = (noFederate: boolean): void => {
        this.setState({ noFederate });
    };

    private onNameValidate = async (fieldState: IFieldState): Promise<IValidationResult> => {
        const result = await CreateRoomDialog.validateRoomName(fieldState);
        this.setState({ nameIsValid: !!result.valid });
        return result;
    };

    private onIsPublicKnockRoomChange = (isPublicKnockRoom: boolean): void => {
        this.setState({ isPublicKnockRoom });
    };

    private onAvatarChange = (avatar: File | null): void => {
        this.setState({ avatar: avatar || undefined });
    };

    private onAvatarClick = (): void => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                this.onAvatarChange(file);
            }
        };
        fileInput.click();
    };

    private onRemoveAvatar = (): void => {
        this.setState({ avatar: undefined });
    };

    private onAgendaTypeChange = (agendaType: 'proposal' | 'discussion'): void => {
        this.setState({ agendaType });
    };

    private onImageUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        if (!file.type.startsWith('image/')) return;

        const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const url = URL.createObjectURL(file);
        
        this.setState(prevState => ({
            embeddedImages: [...prevState.embeddedImages, { id, file, url }]
        }));

        // Reset the input
        event.target.value = '';
    };

    private onRemoveImage = (imageId: string): void => {
        this.setState(prevState => {
            const imageToRemove = prevState.embeddedImages.find(img => img.id === imageId);
            if (imageToRemove) {
                URL.revokeObjectURL(imageToRemove.url);
            }
            return {
                embeddedImages: prevState.embeddedImages.filter(img => img.id !== imageId)
            };
        });
    };

    private insertImagePlaceholder = (imageId: string): void => {
        const textarea = document.querySelector('.mx_CreateRoomDialog_topic_GOV textarea') as HTMLTextAreaElement;
        if (!textarea) return;

        const placeholder = `[IMAGE:${imageId}]`;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentValue = this.state.topic;
        
        const newValue = currentValue.substring(0, start) + placeholder + currentValue.substring(end);
        this.setState({ topic: newValue });

        // Restore cursor position
        setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
            textarea.focus();
        }, 0);
    };

    private onVotingDurationChange = (duration: number): void => {
        this.setState({
            votingSystem: {
                ...this.state.votingSystem,
                duration
            }
        });
    };

    private onVotingChoiceChange = (index: number, value: string): void => {
        this.setState(prevState => ({
            votingSystem: {
                ...prevState.votingSystem,
                choices: prevState.votingSystem.choices.map((choice, i) => 
                    i === index ? value : choice
                )
            }
        }));
    };

    private static validateRoomName = withValidation({
        rules: [
            {
                key: "required",
                test: async ({ value }) => !!value,
                invalid: () => _t("create_room|name_validation_required"),
            },
        ],
    });

    private isDCASpace(): boolean {
        return this.props.parentSpace?.name === "DCA";
    }

    private isGOVSpace(): boolean {
        return this.props.parentSpace?.name === "GOV";
    }

    private getNextProposalNumber(): number {
        if (!this.props.parentSpace) return 1;
        
        try {
            // Get all child rooms in the GOV space using SpaceStore
            const children = SpaceStore.instance.getChildren(this.props.parentSpace.roomId);
            const childRooms = children.filter(child => !child.isSpaceRoom()); // Exclude subspaces
            
            // Find existing proposal numbers
            const proposalNumbers: number[] = [];
            childRooms.forEach(child => {
                const roomName = child.name;
                const match = roomName.match(/^Proposal #(\d+):/);
                if (match) {
                    proposalNumbers.push(parseInt(match[1], 10));
                }
            });
            
            // Return the next available number
            if (proposalNumbers.length === 0) return 1;
            proposalNumbers.sort((a, b) => a - b);
            
            // Find the next sequential number
            for (let i = 1; i <= proposalNumbers.length + 1; i++) {
                if (!proposalNumbers.includes(i)) {
                    return i;
                }
            }
            
            return proposalNumbers.length + 1;
        } catch (error) {
            console.error("Error getting next proposal number:", error);
            return 1; // Fallback to 1 if there's an error
        }
    }

    public render(): React.ReactNode {
        const isVideoRoom = this.props.type === RoomType.ElementVideo || this.props.type === RoomType.UnstableCall;

        let aliasField: JSX.Element | undefined;
        if (this.state.joinRule === JoinRule.Public) {
            const domain = MatrixClientPeg.safeGet().getDomain()!;
            aliasField = (
                <div className="mx_CreateRoomDialog_aliasContainer">
                    <RoomAliasField
                        ref={this.aliasField}
                        onChange={this.onAliasChange}
                        domain={domain}
                        value={this.state.alias}
                    />
                </div>
            );
        }

        let publicPrivateLabel: JSX.Element | undefined;
        if (this.state.joinRule === JoinRule.Restricted) {
            publicPrivateLabel = (
                <p>
                    {_t(
                        "create_room|join_rule_restricted_label",
                        {},
                        {
                            SpaceName: () => (
                                <strong>{this.props.parentSpace?.name ?? _t("common|unnamed_space")}</strong>
                            ),
                        },
                    )}
                    &nbsp;
                    {_t("create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Public && this.props.parentSpace) {
            publicPrivateLabel = (
                <p>
                    {_t(
                        "create_room|join_rule_public_parent_space_label",
                        {},
                        {
                            SpaceName: () => (
                                <strong>{this.props.parentSpace?.name ?? _t("common|unnamed_space")}</strong>
                            ),
                        },
                    )}
                    &nbsp;
                    {_t("create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Public) {
            publicPrivateLabel = (
                <p>
                    {_t("create_room|join_rule_public_label")}
                    &nbsp;
                    {_t("create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Invite) {
            publicPrivateLabel = (
                <p>
                    {_t("create_room|join_rule_invite_label")}
                    &nbsp;
                    {_t("create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Knock) {
            publicPrivateLabel = <p>{_t("create_room|join_rule_knock_label")}</p>;
        }

        let visibilitySection: JSX.Element | undefined;
        if (this.state.joinRule === JoinRule.Knock) {
            visibilitySection = (
                <LabelledCheckbox
                    className="mx_CreateRoomDialog_labelledCheckbox"
                    label={_t("room_settings|security|publish_room")}
                    onChange={this.onIsPublicKnockRoomChange}
                    value={this.state.isPublicKnockRoom}
                />
            );
        }

        let e2eeSection: JSX.Element | undefined;
        if (this.state.joinRule !== JoinRule.Public) {
            let microcopy: string;
            if (privateShouldBeEncrypted(MatrixClientPeg.safeGet())) {
                if (this.state.canChangeEncryption) {
                    microcopy = isVideoRoom
                        ? _t("create_room|encrypted_video_room_warning")
                        : _t("create_room|encrypted_warning");
                } else {
                    microcopy = _t("create_room|encryption_forced");
                }
            } else {
                microcopy = _t("settings|security|e2ee_default_disabled_warning");
            }
            e2eeSection = (
                <React.Fragment>
                    <LabelledToggleSwitch
                        label={_t("create_room|encryption_label")}
                        onChange={this.onEncryptedChange}
                        value={this.state.isEncrypted}
                        className="mx_CreateRoomDialog_e2eSwitch" // for end-to-end tests
                        disabled={!this.state.canChangeEncryption}
                    />
                    <p>{microcopy}</p>
                </React.Fragment>
            );
        }

        let federateLabel = _t("create_room|unfederated_label_default_off");
        if (SdkConfig.get().default_federate === false) {
            // We only change the label if the default setting is different to avoid jarring text changes to the
            // user. They will have read the implications of turning this off/on, so no need to rephrase for them.
            federateLabel = _t("create_room|unfederated_label_default_on");
        }

        let title: string;
        if (isVideoRoom) {
            title = _t("create_room|title_video_room");
        } else if (this.isDCASpace()) {
            title = "Create a DCA room (Designated Contribution Activities)";
        } else if (this.isGOVSpace()) {
            title = "New agenda";
        } else if (this.props.parentSpace || this.state.joinRule === JoinRule.Knock) {
            title = _t("action|create_a_room");
        } else {
            title =
                this.state.joinRule === JoinRule.Public
                    ? _t("create_room|title_public_room")
                    : _t("create_room|title_private_room");
        }

        return (
            <BaseDialog
                className={`mx_CreateRoomDialog ${this.isGOVSpace() ? "mx_CreateRoomDialog_GOV" : ""}`}
                onFinished={this.props.onFinished}
                title={title}
                screenName="CreateRoom"
            >
                <form onSubmit={this.onOk} onKeyDown={this.onKeyDown}>
                    <div className="mx_Dialog_content">
                        {this.isGOVSpace() && (
                            <div className="mx_CreateRoomDialog_agendaType">
                                <label className="mx_CreateRoomDialog_agendaType_label">Choose agenda type:</label>
                                <div className="mx_CreateRoomDialog_agendaType_options">
                                    <label className="mx_CreateRoomDialog_agendaType_option">
                                        <input
                                            type="radio"
                                            name="agendaType"
                                            value="proposal"
                                            checked={this.state.agendaType === 'proposal'}
                                            onChange={() => this.onAgendaTypeChange('proposal')}
                                            className="mx_CreateRoomDialog_agendaType_radio"
                                        />
                                        <span className="mx_CreateRoomDialog_agendaType_radioLabel">Create Proposal</span>
                                    </label>
                                    <label className="mx_CreateRoomDialog_agendaType_option">
                                        <input
                                            type="radio"
                                            name="agendaType"
                                            value="discussion"
                                            checked={this.state.agendaType === 'discussion'}
                                            onChange={() => this.onAgendaTypeChange('discussion')}
                                            className="mx_CreateRoomDialog_agendaType_radio"
                                        />
                                        <span className="mx_CreateRoomDialog_agendaType_radioLabel">Create Discussion</span>
                                    </label>
                                </div>
                            </div>
                        )}
                        <Field
                            ref={this.nameField}
                            label={
                                this.isDCASpace() ? "Contribution Activity Name" : 
                                this.isGOVSpace() ? 
                                    (this.state.agendaType === 'proposal' ? "Proposal Name" : "Discussion Name") : 
                                _t("common|name")
                            }
                            onChange={this.onNameChange}
                            onValidate={this.onNameValidate}
                            value={this.state.name}
                            className={`mx_CreateRoomDialog_name ${this.isGOVSpace() ? "mx_CreateRoomDialog_name_GOV" : ""}`}
                        />
                        <Field
                            label={
                                this.isDCASpace() ? "Verification Method" : 
                                this.isGOVSpace() ? 
                                    (this.state.agendaType === 'proposal' ? "Proposal Description" : "Discussion Description") : 
                                _t("create_room|topic_label")
                            }
                            onChange={this.onTopicChange}
                            value={this.state.topic}
                            className={`mx_CreateRoomDialog_topic ${this.isGOVSpace() ? "mx_CreateRoomDialog_topic_GOV" : ""}`}
                            element={this.isGOVSpace() ? "textarea" : undefined}
                            rows={this.isGOVSpace() ? 12 : undefined}
                        />
                        {this.isGOVSpace() && (
                            <div className="mx_CreateRoomDialog_section mx_CreateRoomDialog_imageUpload">
                                <div className="mx_CreateRoomDialog_section_header">
                                    <h3 className="mx_CreateRoomDialog_section_title">Images</h3>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={this.onImageUpload}
                                        style={{ display: 'none' }}
                                        id="imageUploadInput"
                                    />
                                    <AccessibleButton
                                        onClick={() => document.getElementById('imageUploadInput')?.click()}
                                        className="mx_CreateRoomDialog_imageUpload_button"
                                        kind="primary"
                                    >
                                        📷 Add Image
                                    </AccessibleButton>
                                </div>
                                {this.state.embeddedImages.length > 0 && (
                                    <div className="mx_CreateRoomDialog_imageUpload_list">
                                        {this.state.embeddedImages.map((image) => (
                                            <div key={image.id} className="mx_CreateRoomDialog_imageUpload_item">
                                                <div className="mx_CreateRoomDialog_imageUpload_preview_container">
                                                    <img
                                                        src={image.url}
                                                        alt="Uploaded"
                                                        className="mx_CreateRoomDialog_imageUpload_preview"
                                                    />
                                                </div>
                                                <div className="mx_CreateRoomDialog_imageUpload_actions">
                                                    <AccessibleButton
                                                        onClick={() => this.insertImagePlaceholder(image.id)}
                                                        className="mx_CreateRoomDialog_imageUpload_insert"
                                                        kind="secondary"
                                                    >
                                                        Insert
                                                    </AccessibleButton>
                                                    <AccessibleButton
                                                        onClick={() => this.onRemoveImage(image.id)}
                                                        className="mx_CreateRoomDialog_imageUpload_remove"
                                                        kind="danger"
                                                    >
                                                        Remove
                                                    </AccessibleButton>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="mx_CreateRoomDialog_imageUpload_help">
                                    <span className="mx_CreateRoomDialog_help_icon">💡</span>
                                    Upload images and click "Insert" to add them to your description at the cursor position.
                                </div>
                            </div>
                        )}
                        {this.isGOVSpace() && this.state.agendaType === 'proposal' && (
                            <div className="mx_CreateRoomDialog_section mx_CreateRoomDialog_votingSystem">
                                <div className="mx_CreateRoomDialog_section_header">
                                    <h3 className="mx_CreateRoomDialog_section_title">Voting System</h3>
                                    <div className="mx_CreateRoomDialog_votingSystem_type_badge">
                                        🗳️ Basic Voting
                                    </div>
                                </div>
                                <div className="mx_CreateRoomDialog_votingSystem_content">
                                    <div className="mx_CreateRoomDialog_votingSystem_settings">
                                        <div className="mx_CreateRoomDialog_votingSystem_duration">
                                            <Field
                                                element="select"
                                                value={this.state.votingSystem.duration.toString()}
                                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => 
                                                    this.onVotingDurationChange(parseInt(e.target.value))
                                                }
                                                className="mx_CreateRoomDialog_votingSystem_duration_dropdown"
                                                label="Voting Duration"
                                            >
                                                {Array.from({length: 12}, (_, i) => i + 3).map(days => (
                                                    <option key={days} value={days}>
                                                        {days} day{days !== 1 ? 's' : ''}
                                                    </option>
                                                ))}
                                            </Field>
                                        </div>
                                    </div>
                                    <div className="mx_CreateRoomDialog_votingSystem_choices">
                                        <h4 className="mx_CreateRoomDialog_votingSystem_choicesTitle">Voting Options</h4>
                                        <div className="mx_CreateRoomDialog_votingSystem_choicesList">
                                            {this.state.votingSystem.choices.map((choice, index) => (
                                                <div key={index} className="mx_CreateRoomDialog_votingSystem_choiceItem">
                                                    <div className="mx_CreateRoomDialog_votingSystem_choiceIcon">
                                                        {index === 0 && <span className="mx_CreateRoomDialog_votingSystem_icon mx_CreateRoomDialog_votingSystem_icon_for">✓</span>}
                                                        {index === 1 && <span className="mx_CreateRoomDialog_votingSystem_icon mx_CreateRoomDialog_votingSystem_icon_abstain">●</span>}
                                                    </div>
                                                    <Field
                                                        type="text"
                                                        value={choice}
                                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                                                            this.onVotingChoiceChange(index, e.target.value)
                                                        }
                                                        className="mx_CreateRoomDialog_votingSystem_choiceInput"
                                                        placeholder={['For', 'Against or Abstain'][index] || 'Enter choice'}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="mx_CreateRoomDialog_votingSystem_info">
                                        <span className="mx_CreateRoomDialog_help_icon">ℹ️</span>
                                        {`Basic voting with For and Against or Abstain options. Voting will be open for ${this.state.votingSystem.duration} day${this.state.votingSystem.duration !== 1 ? 's' : ''}.`}
                                    </div>
                                </div>
                            </div>
                        )}
                        {this.isGOVSpace() && (
                            <div className="mx_CreateRoomDialog_avatar">
                                <label className="mx_CreateRoomDialog_avatar_label">
                                    {this.state.agendaType === 'proposal' ? "Proposal Avatar" : "Discussion Avatar"}
                                </label>
                                <div className="mx_CreateRoomDialog_avatar_container">
                                    {this.state.avatar ? (
                                        <div className="mx_CreateRoomDialog_avatar_preview">
                                            <img 
                                                src={URL.createObjectURL(this.state.avatar)} 
                                                alt={this.state.agendaType === 'proposal' ? "Proposal Avatar" : "Discussion Avatar"}
                                                className="mx_CreateRoomDialog_avatar_image"
                                            />
                                            <div className="mx_CreateRoomDialog_avatar_buttons">
                                                <AccessibleButton 
                                                    onClick={this.onAvatarClick}
                                                    className="mx_CreateRoomDialog_avatar_button"
                                                >
                                                    Change Avatar
                                                </AccessibleButton>
                                                <AccessibleButton 
                                                    onClick={this.onRemoveAvatar}
                                                    className="mx_CreateRoomDialog_avatar_button mx_CreateRoomDialog_avatar_button_remove"
                                                >
                                                    Remove
                                                </AccessibleButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mx_CreateRoomDialog_avatar_placeholder">
                                            <AccessibleButton 
                                                onClick={this.onAvatarClick}
                                                className="mx_CreateRoomDialog_avatar_upload"
                                            >
                                                <div className="mx_CreateRoomDialog_avatar_upload_icon">📷</div>
                                                <div className="mx_CreateRoomDialog_avatar_upload_text">
                                                {this.state.agendaType === 'proposal' ? "Upload Proposal Avatar" : "Upload Discussion Avatar"}
                                            </div>
                                            </AccessibleButton>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {this.isDCASpace() && (
                            <Field
                                label="Contribution Value (B)"
                                onChange={this.onContributionValueChange}
                                value={this.state.contributionValue}
                                className="mx_CreateRoomDialog_contributionValue"
                                placeholder="Enter value"
                            />
                        )}

                        {!this.isGOVSpace() && (
                            <JoinRuleDropdown
                                label={_t("create_room|room_visibility_label")}
                                labelInvite={_t("create_room|join_rule_invite")}
                                labelKnock={
                                    this.askToJoinEnabled ? _t("room_settings|security|join_rule_knock") : undefined
                                }
                                labelPublic={_t("common|public_room")}
                                labelRestricted={
                                    this.supportsRestricted ? _t("create_room|join_rule_restricted") : undefined
                                }
                                value={this.state.joinRule}
                                onChange={this.onJoinRuleChange}
                            />
                        )}

                        {publicPrivateLabel}
                        {visibilitySection}
                        {e2eeSection}
                        {aliasField}
                        <details onToggle={this.onDetailsToggled} className="mx_CreateRoomDialog_details">
                            <summary className="mx_CreateRoomDialog_details_summary">
                                {this.state.detailsOpen ? _t("action|hide_advanced") : _t("action|show_advanced")}
                            </summary>
                            <LabelledToggleSwitch
                                label={_t("create_room|unfederated", {
                                    serverName: MatrixClientPeg.safeGet().getDomain(),
                                })}
                                onChange={this.onNoFederateChange}
                                value={this.state.noFederate}
                            />
                            <p>{federateLabel}</p>
                        </details>
                    </div>
                </form>
                <DialogButtons
                    primaryButton={
                        isVideoRoom ? _t("create_room|action_create_video_room") : 
                        this.isGOVSpace() ? 
                            (this.state.agendaType === 'proposal' ? "Create Proposal" : "Create Discussion") :
                        _t("create_room|action_create_room")
                    }
                    onPrimaryButtonClick={this.onOk}
                    onCancel={this.onCancel}
                />
            </BaseDialog>
        );
    }
}
