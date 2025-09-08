/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, useEffect } from "react";
import { type Room, type MatrixClient } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import SettingsTab from "../settings/tabs/SettingsTab";
import { SettingsSection } from "../settings/shared/SettingsSection";
import SettingsFieldset from "../settings/SettingsFieldset";
import Field from "../elements/Field";
import AccessibleButton from "../elements/AccessibleButton";
import { MatrixClientContext } from "../../../contexts/MatrixClientContext";
import "../../../../res/css/views/spaces/_SpaceSettingsGOVTab.pcss";

interface IProps {
    matrixClient: MatrixClient;
    space: Room;
}

interface GOVSettings {
    bTokenRequired: number;
}

const SpaceSettingsGOVTab: React.FC<IProps> = ({ matrixClient: cli, space }) => {
    const [bTokenRequired, setBTokenRequired] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<string>("");

    // Load current settings
    useEffect(() => {
        loadSettings();
    }, [space.roomId]);

    const loadSettings = async (): Promise<void> => {
        setIsLoading(true);
        try {
            // Get the current state event for GOV settings
            const stateEvent = space.currentState.getStateEvents("org.matrix.msc3381.space.gov_settings", "");
            if (stateEvent) {
                const content = stateEvent.getContent();
                const settings: GOVSettings = content.settings || {};
                setBTokenRequired(settings.bTokenRequired?.toString() || "");
            }
        } catch (error) {
            console.error("Failed to load GOV settings:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const saveSettings = async (): Promise<void> => {
        setIsSaving(true);
        setMessage("");
        
        try {
            const bTokenValue = parseFloat(bTokenRequired);
            if (isNaN(bTokenValue) || bTokenValue < 0) {
                setMessage(_t("gov_settings|invalid_b_token_amount"));
                return;
            }

            const settings: GOVSettings = {
                bTokenRequired: bTokenValue,
            };

            await cli.sendStateEvent(space.roomId, "org.matrix.msc3381.space.gov_settings", {
                settings,
            }, "");

            setMessage(_t("gov_settings|settings_saved"));
        } catch (error) {
            console.error("Failed to save GOV settings:", error);
            setMessage(_t("gov_settings|save_error"));
        } finally {
            setIsSaving(false);
        }
    };

    const onBTokenChange = (ev: React.ChangeEvent<HTMLInputElement>): void => {
        setBTokenRequired(ev.target.value);
        setMessage("");
    };

    if (isLoading) {
        return (
            <SettingsTab>
                <SettingsSection heading={_t("gov_settings|title")}>
                    <div>{_t("common|loading")}</div>
                </SettingsSection>
            </SettingsTab>
        );
    }

    return (
        <SettingsTab>
            <SettingsSection heading={_t("gov_settings|title")}>
                <SettingsFieldset
                    legend={_t("gov_settings|b_token_condition_title")}
                    description={_t("gov_settings|b_token_condition_description")}
                >
                    <Field
                        label={_t("gov_settings|b_token_required_label")}
                        description={_t("gov_settings|b_token_required_description")}
                        type="number"
                        value={bTokenRequired}
                        onChange={onBTokenChange}
                        placeholder="0"
                        min="0"
                        step="0.1"
                    />
                    
                    {message && (
                        <div className={`mx_SpaceSettingsGOVTab_message ${
                            message.includes("error") || message.includes("invalid") ? "error" : "success"
                        }`}>
                            {message}
                        </div>
                    )}
                    
                    <div className="mx_SpaceSettingsGOVTab_actions">
                        <AccessibleButton
                            kind="primary"
                            onClick={saveSettings}
                            disabled={isSaving}
                        >
                            {isSaving ? _t("common|saving") : _t("gov_settings|save_settings")}
                        </AccessibleButton>
                    </div>
                </SettingsFieldset>
            </SettingsSection>
        </SettingsTab>
    );
};

export default SpaceSettingsGOVTab;
