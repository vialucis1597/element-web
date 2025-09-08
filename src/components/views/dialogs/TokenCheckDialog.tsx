/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import Spinner from "../elements/Spinner";
import "../../../../res/css/views/dialogs/_TokenCheckDialog.pcss";

interface IProps {
    onFinished(): void;
}

const TokenCheckDialog: React.FC<IProps> = ({ onFinished }) => {
    return (
        <BaseDialog
            title={_t("gov_settings|checking_tokens_title")}
            className="mx_TokenCheckDialog"
            onFinished={onFinished}
            hasCancel={false}
        >
            <div className="mx_TokenCheckDialog_content">
                <div className="mx_TokenCheckDialog_spinner">
                    <Spinner />
                </div>
                <div className="mx_TokenCheckDialog_message">
                    {_t("gov_settings|checking_tokens_message")}
                </div>
            </div>
        </BaseDialog>
    );
};

export default TokenCheckDialog;
