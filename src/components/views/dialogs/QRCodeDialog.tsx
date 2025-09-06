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
        console.log("📋 Copy Address button clicked");
        try {
            navigator.clipboard.writeText(props.address);
            console.log("✅ Address copied to clipboard:", props.address);
            
            // Visual feedback
            const button = document.querySelector('.mx_QRCodeDialog_copyButton') as HTMLElement;
            if (button) {
                const originalText = button.textContent;
                button.textContent = "Copied!";
                setTimeout(() => {
                    button.textContent = originalText;
                }, 1000);
            }
        } catch (error) {
            console.error("❌ Failed to copy address:", error);
        }
    };

    const handleSaveQRImage = (): void => {
        console.log("💾 Save Image button clicked");
        try {
            // QRCode component uses img tag, not canvas - look for the img element
            const qrImg = document.querySelector('.mx_QRCodeDialog_qrCode img') as HTMLImageElement;
            console.log("🔍 Looking for QR image:", qrImg);
            
            if (!qrImg) {
                console.error("❌ QR code image not found");
                // Try alternative selectors
                const alternativeImg = document.querySelector('.mx_VerificationQRCode') as HTMLImageElement;
                console.log("🔍 Alternative image search:", alternativeImg);
                
                if (!alternativeImg) {
                    alert("QR code image not found. Please try again.");
                    return;
                }
                
                // Use alternative image
                const link = document.createElement('a');
                link.download = 'MY-Wallet-QR.png';
                link.href = alternativeImg.src;
                
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                console.log(`✅ QR code saved as ${link.download} (alternative method)`);
                
                // Visual feedback
                const button = document.querySelector('.mx_QRCodeDialog_saveButton') as HTMLElement;
                if (button) {
                    const originalText = button.textContent;
                    button.textContent = "Saved!";
                    setTimeout(() => {
                        button.textContent = originalText;
                    }, 1000);
                }
                return;
            }

            // Create download link using the img src (which is already a data URL)
            const link = document.createElement('a');
            link.download = 'MY-Wallet-QR.png';
            link.href = qrImg.src;
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            console.log(`✅ QR code saved as ${link.download}`);
            
            // Visual feedback
            const button = document.querySelector('.mx_QRCodeDialog_saveButton') as HTMLElement;
            if (button) {
                const originalText = button.textContent;
                button.textContent = "Saved!";
                setTimeout(() => {
                    button.textContent = originalText;
                }, 1000);
            }
        } catch (error) {
            console.error("❌ Failed to save QR code:", error);
            alert("Failed to save QR code. Please try again.");
        }
    };

    return (
        <BaseDialog
            className="mx_QRCodeDialog"
            hasCancel={true}
            onFinished={props.onFinished}
            title="MY Wallet QR Code"
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
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleCopyAddress();
                            }}
                            className="mx_QRCodeDialog_copyButton"
                            data-testid="copy-address-button"
                        >
                            Copy Address
                        </AccessibleButton>
                        <AccessibleButton 
                            kind="secondary"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleSaveQRImage();
                            }}
                            className="mx_QRCodeDialog_saveButton"
                            data-testid="save-image-button"
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
