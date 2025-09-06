/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, useEffect, type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "./BaseDialog";
import Spinner from "../elements/Spinner";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import SpaceStore from "../../../stores/spaces/SpaceStore";

interface Transaction {
    type: string;
    from: string;
    to: string;
    amount: number;
    balance?: number;
    senderBalance?: number;
    recipientBalance?: number;
    timestamp: number;
    verifier: string;
    verifierUserId: string;
    txHash: string;
    signature?: string;
    eventId: string;
}

interface IProps {
    daoId: string;
    daoName: string;
    walletAddress: string;
    onFinished(): void;
}

export default function TransactionHistoryDialog(props: IProps): JSX.Element {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadTransactionHistory();
    }, [props.daoId, props.walletAddress]);

    const loadTransactionHistory = async (): Promise<void> => {
        try {
            console.log(`📜 Loading transaction history for ${props.daoName} - ${props.walletAddress}`);
            setIsLoading(true);
            setError(null);

            const client = MatrixClientPeg.safeGet();
            const daoSpace = client.getRoom(props.daoId);
            if (!daoSpace) {
                throw new Error("DAO space not found");
            }

            // Find ledger room
            const children = SpaceStore.instance.getChildren(props.daoId);
            const ledgerRoom = children.find(child => {
                const room = client.getRoom(child.roomId);
                return room && room.name && room.name.toLowerCase().includes("ledger");
            });

            if (!ledgerRoom) {
                throw new Error("Ledger room not found");
            }

            const room = client.getRoom(ledgerRoom.roomId);
            if (!room) {
                throw new Error("Ledger room not accessible");
            }

            console.log(`📜 Found ledger room: ${room.name}`);

            // Get transaction history
            const userTransactions = await getTransactionHistory(room, props.walletAddress);
            console.log(`📜 Found ${userTransactions.length} transactions for ${props.walletAddress}`);

            setTransactions(userTransactions);
        } catch (err) {
            console.error("Failed to load transaction history:", err);
            setError(err instanceof Error ? err.message : "Failed to load transaction history");
        } finally {
            setIsLoading(false);
        }
    };

    const getTransactionHistory = async (room: Room, walletAddress: string): Promise<Transaction[]> => {
        const transactions: Transaction[] = [];
        const timeline = room.getLiveTimeline();
        const events = timeline.getEvents();

        // Also try to paginate backwards to get more history
        const client = MatrixClientPeg.safeGet();
        try {
            await client.paginateEventTimeline(timeline, { backwards: true, limit: 100 });
        } catch (err) {
            console.warn("Failed to paginate timeline:", err);
        }

        const allEvents = timeline.getEvents();
        console.log(`📜 Processing ${allEvents.length} events from ledger`);

        for (const event of allEvents) {
            if (event.getType() !== "m.room.message") continue;

            const content = event.getContent();
            if (!content.transaction_data) continue;

            const txData = content.transaction_data;
            
            // Check if this transaction involves the user's wallet
            const isInvolved = txData.from === walletAddress || txData.to === walletAddress;
            if (!isInvolved) continue;

            const transaction: Transaction = {
                type: txData.type || "unknown",
                from: txData.from || "",
                to: txData.to || "",
                amount: Number(txData.amount) || 0,
                balance: txData.balance,
                senderBalance: txData.senderBalance,
                recipientBalance: txData.recipientBalance,
                timestamp: txData.timestamp ? new Date(txData.timestamp).getTime() : event.getTs(),
                verifier: txData.verifier || "",
                verifierUserId: txData.verifierUserId || "",
                txHash: txData.txHash || "",
                signature: txData.signature,
                eventId: event.getId() || "",
            };

            transactions.push(transaction);
        }

        // Sort by timestamp (newest first)
        return transactions.sort((a, b) => b.timestamp - a.timestamp);
    };

    const formatDate = (timestamp: number): string => {
        return new Date(timestamp).toLocaleString();
    };

    const formatAddress = (address: string): string => {
        if (address.length <= 12) return address;
        return `${address.substring(0, 6)}...${address.substring(address.length - 6)}`;
    };

    const getTransactionType = (tx: Transaction): { label: string; color: string } => {
        if (tx.type === "PoC:issue") {
            return { label: "Issue", color: "#4caf50" };
        } else if (tx.type === "PoC:transfer") {
            if (tx.from === props.walletAddress) {
                return { label: "Sent", color: "#f44336" };
            } else {
                return { label: "Received", color: "#2196f3" };
            }
        }
        return { label: tx.type, color: "#9e9e9e" };
    };

    const getBalanceForUser = (tx: Transaction): number => {
        if (tx.from === props.walletAddress) {
            return tx.senderBalance ?? tx.balance ?? 0;
        } else {
            return tx.recipientBalance ?? tx.balance ?? 0;
        }
    };

    return (
        <BaseDialog
            className="mx_TransactionHistoryDialog"
            hasCancel={true}
            onFinished={props.onFinished}
            title={`Transaction History - ${props.daoName} DAO`}
        >
            <div className="mx_TransactionHistoryDialog_content">
                {isLoading && (
                    <div className="mx_TransactionHistoryDialog_loading">
                        <Spinner />
                        <p>Loading transaction history...</p>
                    </div>
                )}

                {error && (
                    <div className="mx_TransactionHistoryDialog_error">
                        <p>{error}</p>
                    </div>
                )}

                {!isLoading && !error && (
                    <div className="mx_TransactionHistoryDialog_transactions">
                        {transactions.length === 0 ? (
                            <div className="mx_TransactionHistoryDialog_empty">
                                <p>No transactions found for this wallet.</p>
                            </div>
                        ) : (
                            <div className="mx_TransactionHistoryDialog_list">
                                {transactions.map((tx, index) => {
                                    const txType = getTransactionType(tx);
                                    const userBalance = getBalanceForUser(tx);
                                    
                                    return (
                                        <div 
                                            key={tx.eventId || index} 
                                            className="mx_TransactionHistoryDialog_row"
                                            style={{ marginBottom: index < transactions.length - 1 ? '16px' : '0' }}
                                        >
                                            <div className="mx_TransactionHistoryDialog_cell">
                                                <strong>Type:</strong> 
                                                <span 
                                                    className="mx_TransactionHistoryDialog_type"
                                                    style={{ color: txType.color, marginLeft: '8px' }}
                                                >
                                                    {txType.label}
                                                </span>
                                            </div>
                                            <div className="mx_TransactionHistoryDialog_cell">
                                                <strong>From/To:</strong>
                                                <span style={{ marginLeft: '8px' }}>
                                                    {tx.type === "PoC:issue" ? (
                                                        "System Issue"
                                                    ) : tx.from === props.walletAddress ? (
                                                        `→ ${formatAddress(tx.to)}`
                                                    ) : (
                                                        `← ${formatAddress(tx.from)}`
                                                    )}
                                                </span>
                                            </div>
                                            <div className="mx_TransactionHistoryDialog_cell">
                                                <strong>Amount:</strong>
                                                <span style={{ marginLeft: '8px' }}>{tx.amount}B</span>
                                            </div>
                                            <div className="mx_TransactionHistoryDialog_cell">
                                                <strong>Balance:</strong>
                                                <span style={{ marginLeft: '8px' }}>{userBalance}B</span>
                                            </div>
                                            <div className="mx_TransactionHistoryDialog_cell">
                                                <strong>Date:</strong>
                                                <span style={{ marginLeft: '8px' }}>{formatDate(tx.timestamp)}</span>
                                            </div>
                                            <div className="mx_TransactionHistoryDialog_cell">
                                                <strong>TX Hash:</strong>
                                                <span style={{ marginLeft: '8px' }}>{formatAddress(tx.txHash)}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </BaseDialog>
    );
}
