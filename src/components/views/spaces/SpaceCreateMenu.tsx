/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, {
    type ComponentProps,
    type RefObject,
    type SyntheticEvent,
    type KeyboardEvent,
    useContext,
    useRef,
    useState,
    type ChangeEvent,
    type ReactNode,
    useEffect,
} from "react";
import classNames from "classnames";
import {
    RoomType,
    HistoryVisibility,
    Preset,
    Visibility,
    JoinRule,
    type MatrixClient,
    type ICreateRoomOpts,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../languageHandler";
import ContextMenu, { ChevronFace } from "../../structures/ContextMenu";
import createRoom, { type IOpts as ICreateOpts } from "../../../createRoom";
import MatrixClientContext, { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import type SpaceBasicSettings from "./SpaceBasicSettings";
import { SpaceAvatar } from "./SpaceBasicSettings";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import Field from "../elements/Field";
import withValidation from "../elements/Validation";
import RoomAliasField from "../elements/RoomAliasField";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { Filter } from "../dialogs/spotlight/Filter";
import { type OpenSpotlightPayload } from "../../../dispatcher/payloads/OpenSpotlightPayload.ts";

export const createDAO = async (
    client: MatrixClient,
    name: string,
    isPublic: boolean,
    alias?: string,
    topic?: string,
    avatar?: string | File,
    createOpts: Partial<ICreateRoomOpts> = {},
    otherOpts: Partial<Omit<ICreateOpts, "createOpts">> = {},
): Promise<string | null> => {
    const daoRoomId = await createRoom(client, {
        createOpts: {
            name,
            preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
            visibility:
                isPublic && (await client.doesServerSupportUnstableFeature("org.matrix.msc3827.stable"))
                    ? Visibility.Public
                    : Visibility.Private,
            power_level_content_override: {
                events_default: 100,
                invite: isPublic ? 0 : 50,
            },
            room_alias_name: isPublic && alias ? alias.substring(1, alias.indexOf(":")) : undefined,
            topic,
            ...createOpts,
        },
        avatar,
        roomType: RoomType.Space,
        historyVisibility: isPublic ? HistoryVisibility.WorldReadable : HistoryVisibility.Invited,
        spinner: false,
        encryption: false,
        andView: true,
        inlineErrors: true,
        ...otherOpts,
    });

    if (daoRoomId) {
        await createSubspaces(client, daoRoomId, name);
    }

    return daoRoomId;
};

const createSubspaces = async (client: MatrixClient, parentRoomId: string, daoName: string): Promise<void> => {
    try {
        // Wait for parent space to be available in client
        let parentSpace = client.getRoom(parentRoomId);
        let attempts = 0;
        while (!parentSpace && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            parentSpace = client.getRoom(parentRoomId);
            attempts++;
        }

        if (!parentSpace) {
            logger.error("Parent space not found after waiting");
            return;
        }

        await createRoom(client, {
            createOpts: {
                name: `GOV`,
                preset: Preset.PublicChat,
                visibility: Visibility.Private,
                power_level_content_override: {
                    events_default: 100,
                    invite: 0,
                },
                topic: `Snapshot Governance space for ${daoName} DAO`,
            },
            roomType: RoomType.Space,
            historyVisibility: HistoryVisibility.Invited,
            spinner: false,
            encryption: false,
            andView: false,
            inlineErrors: true,
            parentSpace,
            joinRule: JoinRule.Public,
        });

        await createRoom(client, {
            createOpts: {
                name: `DCA`,
                preset: Preset.PublicChat,
                visibility: Visibility.Private,
                power_level_content_override: {
                    events_default: 0,
                    invite: 0,
                },
                topic: `Designated Contribution Activities space for ${daoName} DAO`,
            },
            roomType: RoomType.Space,
            historyVisibility: HistoryVisibility.Invited,
            spinner: false,
            encryption: false,
            andView: false,
            inlineErrors: true,
            parentSpace,
            joinRule: JoinRule.Public,
        });

        // Create Ledger room for blockchain-style transaction recording
        const ledgerRoomId = await createRoom(client, {
            createOpts: {
                name: `ledger`,
                preset: Preset.PublicChat,
                visibility: Visibility.Private,
                power_level_content_override: {
                    events_default: 100, // Only high-level users can write transactions
                    invite: 0,
                    state_default: 100,
                    users_default: 0,
                },
                topic: `Blockchain ledger for ${daoName} DAO - All transactions are recorded here`,
            },
            historyVisibility: HistoryVisibility.Invited,
            spinner: false,
            encryption: false,
            andView: false,
            inlineErrors: true,
            parentSpace,
            joinRule: JoinRule.Public,
        });

        // Move ledger room to Low priority
        if (ledgerRoomId) {
            setTimeout(async () => {
                try {
                    const { tagRoom } = await import("../../../utils/room/tagRoom");
                    const { DefaultTagID } = await import("../../../stores/room-list/models");
                    
                    const ledgerRoom = client.getRoom(ledgerRoomId);
                    if (ledgerRoom) {
                        // Use the tagRoom utility function which handles the Low priority tagging
                        tagRoom(ledgerRoom, DefaultTagID.LowPriority);
                        logger.info("Successfully moved ledger room to Low priority");
                    }
                } catch (error) {
                    logger.error("Failed to move ledger room to Low priority:", error);
                }
            }, 3000); // Wait 3 seconds for room to be fully synced
        }
    } catch (error) {
        logger.error("Failed to create subspaces:", error);
    }
};

export const createSpace = createDAO;

const SpaceCreateMenuType: React.FC<{
    title: string;
    description: string;
    className: string;
    onClick(): void;
}> = ({ title, description, className, onClick }) => {
    return (
        <AccessibleButton className={classNames("mx_SpaceCreateMenuType", className)} onClick={onClick}>
            {title}
            <div>{description}</div>
        </AccessibleButton>
    );
};

const spaceNameValidator = withValidation({
    rules: [
        {
            key: "required",
            test: async ({ value }) => !!value,
            invalid: () => _t("create_space|name_required"),
        },
    ],
});

const nameToLocalpart = (name: string): string => {
    return name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]+/gi, "");
};

type BProps = Omit<ComponentProps<typeof SpaceBasicSettings>, "nameDisabled" | "topicDisabled" | "avatarDisabled">;
interface ISpaceCreateFormProps extends BProps {
    busy: boolean;
    alias: string;
    nameFieldRef: RefObject<Field | null>;
    aliasFieldRef: RefObject<RoomAliasField | null>;
    showAliasField?: boolean;
    children?: ReactNode;
    onSubmit(e: SyntheticEvent): void;
    setAlias(alias: string): void;
}

export const SpaceCreateForm: React.FC<ISpaceCreateFormProps> = ({
    busy,
    onSubmit,
    avatarUrl,
    setAvatar,
    name,
    setName,
    nameFieldRef,
    alias,
    aliasFieldRef,
    setAlias,
    showAliasField,
    topic,
    setTopic,
    children,
}) => {
    const cli = useContext(MatrixClientContext);
    const domain = cli.getDomain() ?? undefined;

    const onKeyDown = (ev: KeyboardEvent): void => {
        const action = getKeyBindingsManager().getAccessibilityAction(ev);
        switch (action) {
            case KeyBindingAction.Enter:
                onSubmit(ev);
                break;
        }
    };

    return (
        <form className="mx_SpaceBasicSettings" onSubmit={onSubmit}>
            <SpaceAvatar avatarUrl={avatarUrl} setAvatar={setAvatar} avatarDisabled={busy} />

            <Field
                name="spaceName"
                label={_t("common|name")}
                autoFocus={true}
                value={name}
                onChange={(ev: ChangeEvent<HTMLInputElement>) => {
                    const newName = ev.target.value;
                    if (!alias || alias === `#${nameToLocalpart(name)}:${domain}`) {
                        setAlias(`#${nameToLocalpart(newName)}:${domain}`);
                        aliasFieldRef.current?.validate({ allowEmpty: true });
                    }
                    setName(newName);
                }}
                onKeyDown={onKeyDown}
                ref={nameFieldRef}
                onValidate={spaceNameValidator}
                disabled={busy}
                autoComplete="off"
            />

            {showAliasField ? (
                <RoomAliasField
                    ref={aliasFieldRef}
                    onChange={setAlias}
                    domain={domain}
                    value={alias}
                    placeholder={name ? nameToLocalpart(name) : _t("create_space|address_placeholder")}
                    label={_t("create_space|address_label") + " (Auto-generated)"}
                    disabled={busy}
                    onKeyDown={onKeyDown}
                />
            ) : null}

            <Field
                name="spaceTopic"
                element="textarea"
                label={_t("common|description")}
                value={topic ?? ""}
                onChange={(ev) => setTopic(ev.target.value)}
                rows={3}
                disabled={busy}
            />

            {children}
        </form>
    );
};

const SpaceCreateMenu: React.FC<{
    onFinished(): void;
}> = ({ onFinished }) => {
    const cli = useMatrixClientContext();
    const [visibility, setVisibility] = useState<Visibility | null>(null);
    const [busy, setBusy] = useState<boolean>(false);

    const [name, setName] = useState("");
    const spaceNameField = useRef<Field>(null);
    const [alias, setAlias] = useState("");
    const spaceAliasField = useRef<RoomAliasField>(null);
    const [avatar, setAvatar] = useState<File | undefined>(undefined);
    const [topic, setTopic] = useState<string>("");

    const [supportsSpaceFiltering, setSupportsSpaceFiltering] = useState(true); // assume it does until we find out it doesn't
    useEffect(() => {
        cli.isVersionSupported("v1.4")
            .then((supported) => {
                return supported || cli.doesServerSupportUnstableFeature("org.matrix.msc3827.stable");
            })
            .then((supported) => {
                setSupportsSpaceFiltering(supported);
            });
    }, [cli]);

    const onSpaceCreateClick = async (e: ButtonEvent): Promise<void> => {
        e.preventDefault();
        if (busy) return;

        setBusy(true);
        // require & validate the space name field
        if (spaceNameField.current && !(await spaceNameField.current.validate({ allowEmpty: false }))) {
            spaceNameField.current.focus();
            spaceNameField.current.validate({ allowEmpty: false, focused: true });
            setBusy(false);
            return;
        }

        if (
            spaceAliasField.current &&
            visibility === Visibility.Public &&
            !(await spaceAliasField.current.validate({ allowEmpty: false }))
        ) {
            spaceAliasField.current.focus();
            spaceAliasField.current.validate({ allowEmpty: false, focused: true });
            setBusy(false);
            return;
        }

        try {
            await createDAO(cli, name, visibility === Visibility.Public, alias, topic, avatar);

            onFinished();
        } catch (e) {
            logger.error("DAO creation failed:", e);
            setBusy(false);
            
            // 주소 중복 에러 처리
            if (e.message?.includes("Room alias") || e.message?.includes("already taken") || e.errcode === "M_ROOM_IN_USE") {
                console.log("Address already taken, showing error to user");
                // 주소 필드에 포커스하고 에러 표시
                if (spaceAliasField.current) {
                    spaceAliasField.current.focus();
                    // 강제로 validation 실패 상태로 만들기
                    spaceAliasField.current.validate({ 
                        allowEmpty: false, 
                        focused: true
                    });
                }
            } else {
                // 기타 에러의 경우 이름 필드에 포커스
                if (spaceNameField.current) {
                    spaceNameField.current.focus();
                }
            }
        }
    };

    const onSearchClick = (): void => {
        defaultDispatcher.dispatch<OpenSpotlightPayload>({
            action: Action.OpenSpotlight,
            initialFilter: Filter.PublicSpaces,
        });
    };

    let body;
    if (visibility === null) {
        body = (
            <React.Fragment>
                <h2>Create a DAO</h2>
                <p>DAOs are autonomous organizations with shared goals. What kind of DAO do you want to create? You can change this later.</p>

                <SpaceCreateMenuType
                    title={_t("common|public")}
                    description="Open DAO for anyone, best for communities"
                    className="mx_SpaceCreateMenuType_public"
                    onClick={() => setVisibility(Visibility.Public)}
                />
                <SpaceCreateMenuType
                    title={_t("common|private")}
                    description="Invite only, best for yourself or teams"
                    className="mx_SpaceCreateMenuType_private"
                    onClick={() => setVisibility(Visibility.Private)}
                />

                {supportsSpaceFiltering && (
                    <AccessibleButton kind="primary_outline" onClick={onSearchClick}>
                        Search for public DAOs
                    </AccessibleButton>
                )}
            </React.Fragment>
        );
    } else {
        body = (
            <React.Fragment>
                <AccessibleButton
                    className="mx_SpaceCreateMenu_back"
                    onClick={() => setVisibility(null)}
                    title={_t("action|go_back")}
                />

                <h2>
                    {visibility === Visibility.Public
                        ? "Your public DAO"
                        : "Your private DAO"}
                </h2>
                <p>
                    Add some details to help people recognize it. You can change these anytime.
                </p>

                <SpaceCreateForm
                    busy={busy}
                    onSubmit={onSpaceCreateClick}
                    setAvatar={setAvatar}
                    name={name}
                    setName={setName}
                    nameFieldRef={spaceNameField}
                    topic={topic}
                    setTopic={setTopic}
                    alias={alias}
                    setAlias={setAlias}
                    showAliasField={visibility === Visibility.Public}
                    aliasFieldRef={spaceAliasField}
                />

                <AccessibleButton kind="primary" onClick={onSpaceCreateClick} disabled={busy}>
                    {busy ? "Creating..." : "Create DAO"}
                </AccessibleButton>
            </React.Fragment>
        );
    }

    return (
        <ContextMenu
            left={72}
            top={62}
            chevronOffset={0}
            chevronFace={ChevronFace.None}
            onFinished={onFinished}
            wrapperClassName="mx_SpaceCreateMenu_wrapper"
            managed={false}
            focusLock={true}
        >
            {body}
        </ContextMenu>
    );
};

export default SpaceCreateMenu;
