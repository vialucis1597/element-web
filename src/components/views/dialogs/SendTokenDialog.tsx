/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, useCallback, type JSX } from "react";

import BaseDialog from "./BaseDialog";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { DAOMnemonicWallet } from "../../../utils/DAOMnemonicWallet";
import SpaceStore from "../../../stores/spaces/SpaceStore";
import Modal from "../../../Modal";
import InfoDialog from "./InfoDialog";

interface IProps {
    daoId: string;
    daoName: string;
    senderAddress: string;
    maxBalance: number;
    currency: string;
    onFinished(): void;
}

export default function SendTokenDialog(props: IProps): JSX.Element {
    const [recipientAddress, setRecipientAddress] = useState("");
    const [amount, setAmount] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const wallet = DAOMnemonicWallet.getInstance();

    const handleQRUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                console.log("📷 QR Image uploaded, processing...");
                
                // Create image element
                const img = new Image();
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                img.onload = async () => {
                    try {
                        // Set canvas size to match image
                        canvas.width = img.width;
                        canvas.height = img.height;
                        
                        // Draw image on canvas
                        ctx?.drawImage(img, 0, 0);
                        
                        // Get image data
                        const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height);
                        
                        if (imageData) {
                            try {
                                // Try to use jsQR library if available
                                const jsQR = await import('jsqr');
                                const code = jsQR.default(imageData.data, imageData.width, imageData.height);
                                
                                if (code) {
                                    console.log("✅ QR Code decoded:", code.data);
                                    setRecipientAddress(code.data);
                                    setError(null);
                                } else {
                                    console.warn("❌ No QR code found in image");
                                    setError("No QR code found in the uploaded image");
                                }
                            } catch (importError) {
                                console.warn("jsQR library not available, using fallback");
                                // Fallback: For demo purposes, just show that QR was uploaded
                                setError("QR code processing requires additional library. Please manually enter the address.");
                                console.log("📷 QR image uploaded but automatic parsing not available");
                            }
                        }
                    } catch (decodeError) {
                        console.error("Failed to decode QR code:", decodeError);
                        setError("Failed to decode QR code from image");
                    }
                };
                
                // Load image from file
                const reader = new FileReader();
                reader.onload = (event) => {
                    img.src = event.target?.result as string;
                };
                reader.readAsDataURL(file);
                
            } catch (err) {
                console.error("Failed to process QR code:", err);
                setError("Failed to process uploaded image");
            }
        };
        input.click();
    }, []);

    const handleSend = useCallback(async () => {
        if (!recipientAddress.trim()) {
            setError("Please enter recipient address");
            return;
        }

        // Check if trying to send to self
        if (recipientAddress.trim().toLowerCase() === props.senderAddress.toLowerCase()) {
            setError("Cannot send tokens to your own address");
            return;
        }

        if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
            setError("Please enter valid amount");
            return;
        }

        if (Number(amount) > props.maxBalance) {
            setError(`Amount cannot exceed ${props.maxBalance} ${props.currency}`);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await sendTransaction();
            
            Modal.createDialog(InfoDialog, {
                title: "Transaction Sent",
                description: `Successfully sent ${amount} ${props.currency} to ${recipientAddress}`,
                button: "OK",
                onFinished: () => {
                    console.log("🔄 OK button clicked - forcing wallet refresh");
                    // Force immediate wallet update
                    const walletInstance = DAOMnemonicWallet.getInstance();
                    walletInstance.notifyListeners();
                    
                    // Also force refresh from ledger
                    setTimeout(async () => {
                        try {
                            console.log(`🔄 Force refreshing balance from ledger for DAO: ${props.daoId}`);
                            await walletInstance.refreshDAOWalletBalance(props.daoId);
                            console.log("✅ Balance refresh completed");
                        } catch (error) {
                            console.warn("Failed to refresh balance:", error);
                        }
                    }, 100);
                }
            });

            props.onFinished();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to send transaction");
        } finally {
            setIsLoading(false);
        }
    }, [recipientAddress, amount, props]);

    const sendTransaction = async (): Promise<void> => {
        const client = MatrixClientPeg.safeGet();
        const daoSpace = client.getRoom(props.daoId);
        if (!daoSpace) {
            throw new Error("DAO space not found");
        }

        // Find ledger room
        const children = SpaceStore.instance.getChildren(props.daoId);
        const ledgerRoom = children.find(child => {
            const room = client.getRoom(child.roomId);
            return room && !room.isSpaceRoom() && room.name === "ledger";
        });

        if (!ledgerRoom) {
            throw new Error("Ledger room not found");
        }

        const room = client.getRoom(ledgerRoom.roomId);
        if (!room) {
            throw new Error("Failed to get ledger room");
        }

        // Get sender wallet for signing
        const senderWallet = wallet.getDAOWallet(props.daoId);
        if (!senderWallet) {
            throw new Error("Sender wallet not found");
        }

        // Calculate new balances
        const senderAmount = Number(amount);
        const senderNewBalance = senderWallet.balance - senderAmount;
        const recipientAddr = recipientAddress.trim();
        
        // Get recipient's current balance from ledger
        const recipientCurrentBalance = await getRecipientCurrentBalance(room, recipientAddr);
        const recipientNewBalance = recipientCurrentBalance + senderAmount;

        const timestamp = new Date().toISOString();

        // Create transaction data
        const transactionData = {
            type: "PoC:transfer",
            from: props.senderAddress,
            to: recipientAddr,
            amount: senderAmount,
            balance: senderNewBalance, // sender's new balance for compatibility
            senderBalance: senderNewBalance,
            recipientBalance: recipientNewBalance,
            timestamp: timestamp,
            verifier: client.getUserId()?.split(':')[0]?.substring(1) || "unknown",
            verifierUserId: client.getUserId() || "unknown",
            txHash: generateTxHash(),
        };

        // Sign the transaction
        const signature = wallet.signData(props.daoId, JSON.stringify(transactionData));
        if (!signature) {
            throw new Error("Failed to sign transaction");
        }

        // Send transaction to ledger room using the same format as DAOContributionTracker
        await client.sendMessage(room.roomId, {
            msgtype: "m.text",
            body: `🏦 TRANSACTION RECORD 🏦\n${JSON.stringify(transactionData, null, 2)}`,
            format: "org.matrix.custom.html",
            formatted_body: `
                <h3>🏦 TRANSACTION RECORD 🏦</h3>
                <table border="1" style="border-collapse: collapse; width: 100%;">
                    <tr><td><b>Type</b></td><td>${transactionData.type}</td></tr>
                    <tr><td><b>From</b></td><td>${transactionData.from}</td></tr>
                    <tr><td><b>To</b></td><td>${transactionData.to}</td></tr>
                    <tr><td><b>Amount</b></td><td>${transactionData.amount}B</td></tr>
                    <tr><td><b>Sender Balance</b></td><td>${transactionData.senderBalance}B</td></tr>
                    <tr><td><b>Recipient Balance</b></td><td>${transactionData.recipientBalance}B</td></tr>
                    <tr><td><b>Verifier</b></td><td>${transactionData.verifier}</td></tr>
                    <tr><td><b>Verifier ID</b></td><td><code>${transactionData.verifierUserId}</code></td></tr>
                    <tr><td><b>Timestamp</b></td><td>${new Date(transactionData.timestamp).toISOString()}</td></tr>
                    <tr><td><b>TX Hash</b></td><td><code>${transactionData.txHash}</code></td></tr>
                    <tr><td><b>Digital Signature</b></td><td><code>${signature ? signature.substring(0, 32) + "..." : "N/A"}</code></td></tr>
                    <tr><td><b>Signature Status</b></td><td>${signature ? "✅ Signed" : "❌ Unsigned"}</td></tr>
                </table>
            `,
            transaction_data: {
                ...transactionData,
                signature: signature,
            }
        });

        // Update sender wallet balance
        wallet.updateDAOWalletBalance(props.daoId, senderNewBalance);

        console.log(`💸 Transaction sent: ${senderAmount}B from ${props.senderAddress} to ${recipientAddr}`);
        console.log(`💰 New balances - Sender: ${senderNewBalance}B, Recipient: ${recipientNewBalance}B`);

        // Force refresh balance from ledger after a short delay to ensure transaction is processed
        setTimeout(async () => {
            try {
                console.log(`🔄 Refreshing balance from ledger for ${props.senderAddress}`);
                await wallet.refreshDAOWalletBalance(props.daoId);
            } catch (error) {
                console.warn("Failed to refresh balance from ledger:", error);
            }
        }, 500);
    };

    const getRecipientCurrentBalance = async (ledgerRoom: any, recipientAddress: string): Promise<number> => {
        try {
            console.log(`🔍 Getting current balance for recipient: ${recipientAddress}`);
            
            // Get timeline and events
            const timeline = ledgerRoom.getLiveTimeline();
            let allEvents = timeline.getEvents();
            
            // Load more events if needed
            let loadAttempts = 0;
            const maxAttempts = 10;
            
            while (loadAttempts < maxAttempts) {
                try {
                    const client = MatrixClientPeg.safeGet();
                    const paginationToken = timeline.getPaginationToken("b");
                    if (!paginationToken) break;
                    
                    await client.paginateEventTimeline(timeline, { backwards: true, limit: 50 });
                    const newEventCount = timeline.getEvents().length;
                    if (newEventCount === allEvents.length) break;
                    
                    allEvents = timeline.getEvents();
                    loadAttempts++;
                } catch (paginationError) {
                    console.warn("⚠️ Failed to load more events:", paginationError);
                    break;
                }
            }
            
            // Search for latest transaction involving recipient address
            const eventsReversed = [...allEvents].reverse();
            
            for (const event of eventsReversed) {
                if (event.getType() === "m.room.message") {
                    const content = event.getContent();
                    const transactionData = content.transaction_data;
                    
                    if (transactionData) {
                        // Check if this transaction involves the recipient address
                        if (transactionData.to === recipientAddress) {
                            // Recipient received money - use recipientBalance if available, otherwise add amount to previous balance
                            if (typeof transactionData.recipientBalance === 'number') {
                                console.log(`💰 Found recipient balance: ${transactionData.recipientBalance}B`);
                                return transactionData.recipientBalance;
                            } else if (typeof transactionData.balance === 'number') {
                                console.log(`💰 Found recipient balance (legacy): ${transactionData.balance}B`);
                                return transactionData.balance;
                            }
                        } else if (transactionData.from === recipientAddress) {
                            // Recipient sent money - use senderBalance if available, otherwise use balance
                            if (typeof transactionData.senderBalance === 'number') {
                                console.log(`💰 Found sender balance: ${transactionData.senderBalance}B`);
                                return transactionData.senderBalance;
                            } else if (typeof transactionData.balance === 'number') {
                                console.log(`💰 Found sender balance (legacy): ${transactionData.balance}B`);
                                return transactionData.balance;
                            }
                        }
                    }
                }
            }
            
            console.log(`💰 No transaction history found for ${recipientAddress}, starting with 0B`);
            return 0;
        } catch (error) {
            console.error("Error getting recipient balance:", error);
            return 0;
        }
    };

    const generateTxHash = (): string => {
        return Math.random().toString(36).substring(2, 8);
    };

    return (
        <BaseDialog
            className="mx_SendTokenDialog"
            hasCancel={true}
            onFinished={props.onFinished}
            title={`Send Brotherhood - ${props.daoName} DAO`}
            titleClass="mx_SendTokenDialog_title"
        >
            <div className="mx_SendTokenDialog_content">
                <div className="mx_SendTokenDialog_form">
                    <div className="mx_SendTokenDialog_addressRow">
                        <Field
                            label="Recipient Address"
                            placeholder="0x..."
                            value={recipientAddress}
                            onChange={(e) => setRecipientAddress(e.target.value)}
                            type="text"
                            className="mx_SendTokenDialog_addressField"
                        />
                        <AccessibleButton
                            kind="secondary"
                            onClick={handleQRUpload}
                            className="mx_SendTokenDialog_qrButton"
                        >
                            QR Upload
                        </AccessibleButton>
                    </div>

                    <Field
                        label={`Amount (Max: ${props.maxBalance} ${props.currency})`}
                        placeholder="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        type="number"
                        step="1"
                        min="1"
                        max={props.maxBalance}
                    />

                    {error && (
                        <div className="mx_SendTokenDialog_error">
                            {error}
                        </div>
                    )}

                    <div className="mx_SendTokenDialog_actions">
                        <AccessibleButton
                            kind="secondary"
                            onClick={props.onFinished}
                            disabled={isLoading}
                        >
                            Cancel
                        </AccessibleButton>
                        <AccessibleButton
                            kind="primary"
                            onClick={handleSend}
                            disabled={isLoading || !recipientAddress.trim() || !amount.trim()}
                        >
                            {isLoading ? <Spinner w={16} h={16} /> : "Send"}
                        </AccessibleButton>
                    </div>
                </div>
            </div>
        </BaseDialog>
    );
}
