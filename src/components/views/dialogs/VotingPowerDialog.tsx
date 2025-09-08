/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import AccessibleButton from "../elements/AccessibleButton";
import "../../../../res/css/views/dialogs/_VotingPowerDialog.pcss";

interface IProps {
    votingPower: number;
    onFinished: (shouldVote: boolean) => void;
}

const VotingPowerDialog: React.FC<IProps> = ({ votingPower, onFinished }) => {
    const handleVote = () => {
        console.log("Vote button clicked, calling onFinished(true)");
        onFinished(true);
    };

    const handleCancel = () => {
        console.log("Cancel button clicked, calling onFinished(false)");
        onFinished(false);
    };

    return (
        <BaseDialog
            title={_t("voting|power_dialog_title")}
            className="mx_VotingPowerDialog"
            onFinished={() => {
                console.log("BaseDialog onFinished called, calling onFinished(false)");
                onFinished(false);
            }}
            hasCancel={true}
        >
            <div className="mx_VotingPowerDialog_content">
                <div className="mx_VotingPowerDialog_message">
                    {_t("voting|power_dialog_message", { votingPower })}
                </div>
                <div className="mx_VotingPowerDialog_actions">
                    <AccessibleButton
                        kind="primary"
                        onClick={handleVote}
                        className="mx_VotingPowerDialog_voteButton"
                    >
                        {_t("voting|vote_button")}
                    </AccessibleButton>
                    <AccessibleButton
                        kind="secondary"
                        onClick={handleCancel}
                        className="mx_VotingPowerDialog_cancelButton"
                    >
                        {_t("action|cancel")}
                    </AccessibleButton>
                </div>
            </div>
        </BaseDialog>
    );
};

export default VotingPowerDialog;
