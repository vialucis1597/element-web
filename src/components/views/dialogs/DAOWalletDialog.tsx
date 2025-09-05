/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

import BaseDialog from "./BaseDialog";
import DAOWalletPanel from "../wallet/DAOWalletPanel";

interface IProps {
    onFinished(): void;
}

export default function DAOWalletDialog(props: IProps): JSX.Element {
    return (
        <BaseDialog
            className="mx_DAOWalletDialog"
            hasCancel={true}
            onFinished={props.onFinished}
            title="DAO 지갑 관리"
            titleClass="mx_DAOWalletDialog_title"
        >
            <div className="mx_DAOWalletDialog_content">
                <DAOWalletPanel onClose={props.onFinished} />
            </div>
        </BaseDialog>
    );
}
