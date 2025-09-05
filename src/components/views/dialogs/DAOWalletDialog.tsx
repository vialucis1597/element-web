/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

import BaseDialog from "./BaseDialog";
import MyWalletPanel from "../wallet/MyWalletPanel";

interface IProps {
    onFinished(): void;
}

export default function DAOWalletDialog(props: IProps): JSX.Element {
    return (
        <BaseDialog
            className="mx_DAOWalletDialog"
            hasCancel={true}
            onFinished={props.onFinished}
            title="My Wallet"
            titleClass="mx_DAOWalletDialog_title"
        >
            <div className="mx_DAOWalletDialog_content">
                <MyWalletPanel onClose={props.onFinished} />
            </div>
        </BaseDialog>
    );
}
