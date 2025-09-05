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

    const handleSaveQRImage = (): void => {
        try {
            // Get the QR code canvas element
            const qrCanvas = document.querySelector('.mx_QRCodeDialog_qrCode canvas') as HTMLCanvasElement;
            if (!qrCanvas) {
                console.error("QR code canvas not found");
                return;
            }

            // Create download link
            const link = document.createElement('a');
            link.download = `${props.daoName}-wallet-qr.png`;
            link.href = qrCanvas.toDataURL('image/png');
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            console.log(`💾 QR code saved as ${link.download}`);
        } catch (error) {
            console.error("Failed to save QR code:", error);
        }
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
                    <div className="mx_QRCodeDialog_actions">
                        <AccessibleButton 
                            kind="primary"
                            onClick={handleCopyAddress}
                            className="mx_QRCodeDialog_copyButton"
                        >
                            Copy Address
                        </AccessibleButton>
                        <AccessibleButton 
                            kind="secondary"
                            onClick={handleSaveQRImage}
                            className="mx_QRCodeDialog_saveButton"
                        >
                            Save Image
                        </AccessibleButton>
                    </div>
                </div>
                </div>
            </div>
        </BaseDialog>
    );
}
