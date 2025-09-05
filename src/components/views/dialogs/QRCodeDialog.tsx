/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "./BaseDialog";
import QRCode from "../elements/QRCode";
import AccessibleButton from "../elements/AccessibleButton";

interface IProps {
    address: string;
    daoName: string;
    space: Room;
    onFinished(): void;
}

export default function QRCodeDialog(props: IProps): JSX.Element {

    const handleCopyAddress = (): void => {
        navigator.clipboard.writeText(props.address);
    };

    return (
        <BaseDialog
            className="mx_QRCodeDialog"
            hasCancel={true}
            onFinished={props.onFinished}
            title={`${props.daoName} Wallet QR Code`}
            titleClass="mx_QRCodeDialog_title"
        >
            <div className="mx_QRCodeDialog_content">
                <div className="mx_QRCodeDialog_qrContainer">
                    <QRCode data={props.address} className="mx_QRCodeDialog_qrCode" />
                    
                    <div className="mx_QRCodeDialog_info">
                        <p className="mx_QRCodeDialog_label">Wallet Address:</p>
                        <p className="mx_QRCodeDialog_address">{props.address}</p>
                        <AccessibleButton 
                            kind="primary"
                            onClick={handleCopyAddress}
                            className="mx_QRCodeDialog_copyButton"
                        >
                            Copy Address
                        </AccessibleButton>
                    </div>
                </div>
            </div>
        </BaseDialog>
    );
}
