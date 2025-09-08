/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { DAOMnemonicWallet } from "./DAOMnemonicWallet";
import SpaceStore from "../stores/spaces/SpaceStore";

export interface VotingPowerSnapshot {
    walletAddress: string;
    balance: number;
    votingPower: number;
    timestamp: number;
}

export interface AgendaVotingSnapshot {
    agendaRoomId: string;
    agendaName: string;
    snapshotTimestamp: number;
    totalVotingPower: number;
    walletSnapshots: VotingPowerSnapshot[];
}

/**
 * Create a voting power snapshot for all wallets in the DAO ledger
 */
export const createVotingPowerSnapshot = async (
    cli: MatrixClient, 
    agendaRoomId: string, 
    agendaName: string,
    govSpaceId: string
): Promise<AgendaVotingSnapshot> => {
    try {
        console.log(`📸 Creating voting power snapshot for agenda: ${agendaName}`);
        
        // Get the parent DAO space
        const govSpaceRoom = cli.getRoom(govSpaceId);
        if (!govSpaceRoom) {
            throw new Error("GOV space room not found");
        }
        
        const parentSpaces = SpaceStore.instance.getParents(govSpaceRoom.roomId);
        if (parentSpaces.length === 0) {
            throw new Error("No parent DAO found for GOV space");
        }
        
        const parentDAOSpace = parentSpaces[0];
        const parentDAORoom = cli.getRoom(parentDAOSpace.roomId);
        if (!parentDAORoom) {
            throw new Error("Parent DAO room not found");
        }
        
        console.log(`📸 Creating snapshot for DAO: ${parentDAORoom.name}`);
        
        // Get DAO wallet instance
        const daoWallet = DAOMnemonicWallet.getInstance();
        
        // Get all unique wallet addresses from the ledger
        const walletAddresses = await getAllWalletAddressesFromLedger(cli, parentDAORoom.roomId);
        console.log(`📸 Found ${walletAddresses.length} unique wallet addresses in ledger`);
        
        const walletSnapshots: VotingPowerSnapshot[] = [];
        let totalVotingPower = 0;
        
        // Create snapshot for each wallet
        for (const walletAddress of walletAddresses) {
            try {
                const balance = await daoWallet.recoverBalanceFromLedger(parentDAORoom.roomId, walletAddress);
                const votingPower = Math.floor(balance); // 1 B = 1 voting power
                
                walletSnapshots.push({
                    walletAddress,
                    balance,
                    votingPower,
                    timestamp: Date.now()
                });
                
                totalVotingPower += votingPower;
                console.log(`📸 Wallet ${walletAddress}: ${balance}B → ${votingPower} voting power`);
            } catch (error) {
                console.warn(`⚠️ Failed to get balance for wallet ${walletAddress}:`, error);
            }
        }
        
        const snapshot: AgendaVotingSnapshot = {
            agendaRoomId,
            agendaName,
            snapshotTimestamp: Date.now(),
            totalVotingPower,
            walletSnapshots
        };
        
        console.log(`📸 Snapshot created: ${walletSnapshots.length} wallets, ${totalVotingPower} total voting power`);
        
        return snapshot;
    } catch (error) {
        console.error("Failed to create voting power snapshot:", error);
        throw error;
    }
};

/**
 * Get all unique wallet addresses from the DAO ledger
 */
const getAllWalletAddressesFromLedger = async (cli: MatrixClient, daoId: string): Promise<string[]> => {
    try {
        const daoWallet = DAOMnemonicWallet.getInstance();
        const ledgerRoom = daoWallet.findLedgerRoom(daoId);
        if (!ledgerRoom) {
            console.log("No ledger room found");
            return [];
        }
        
        const timeline = ledgerRoom.getLiveTimeline();
        const events = timeline.getEvents();
        
        // Load more events if needed
        let loadedMore = true;
        let loadAttempts = 0;
        const maxAttempts = 10;
        
        while (loadedMore && loadAttempts < maxAttempts) {
            try {
                const paginationToken = timeline.getPaginationToken("b");
                if (!paginationToken) break;
                
                await cli.paginateEventTimeline(timeline, { backwards: true, limit: 50 });
                
                const newEventCount = timeline.getEvents().length;
                if (newEventCount === events.length) {
                    loadedMore = false;
                } else {
                    events.length = newEventCount;
                }
                
                loadAttempts++;
            } catch (paginationError) {
                console.warn("Failed to load more events:", paginationError);
                break;
            }
        }
        
        const walletAddresses = new Set<string>();
        
        // Extract wallet addresses from all transaction events
        for (const event of events) {
            if (event.getType() === "m.room.message") {
                const content = event.getContent();
                const transactionData = content.transaction_data;
                
                if (transactionData) {
                    if (transactionData.from) {
                        walletAddresses.add(transactionData.from);
                    }
                    if (transactionData.to) {
                        walletAddresses.add(transactionData.to);
                    }
                }
            }
        }
        
        return Array.from(walletAddresses);
    } catch (error) {
        console.error("Failed to get wallet addresses from ledger:", error);
        return [];
    }
};

/**
 * Get voting power for a specific wallet address from the snapshot
 */
export const getVotingPowerFromSnapshot = (
    snapshot: AgendaVotingSnapshot, 
    walletAddress: string
): number => {
    const walletSnapshot = snapshot.walletSnapshots.find(
        ws => ws.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    return walletSnapshot ? walletSnapshot.votingPower : 0;
};

/**
 * Save voting power snapshot to the agenda room
 */
export const saveVotingPowerSnapshot = async (
    cli: MatrixClient,
    agendaRoomId: string,
    snapshot: AgendaVotingSnapshot
): Promise<void> => {
    try {
        console.log(`💾 Saving voting power snapshot to agenda room: ${agendaRoomId}`);
        
        await cli.sendStateEvent(agendaRoomId, "org.matrix.msc3381.agenda.voting_snapshot", {
            snapshot
        }, "");
        
        console.log(`✅ Voting power snapshot saved successfully`);
    } catch (error) {
        console.error("Failed to save voting power snapshot:", error);
        throw error;
    }
};

/**
 * Load voting power snapshot from the agenda room
 */
export const loadVotingPowerSnapshot = async (
    cli: MatrixClient,
    agendaRoomId: string
): Promise<AgendaVotingSnapshot | null> => {
    try {
        const room = cli.getRoom(agendaRoomId);
        if (!room) return null;
        
        const stateEvent = room.currentState.getStateEvents("org.matrix.msc3381.agenda.voting_snapshot", "");
        if (!stateEvent) return null;
        
        const content = stateEvent.getContent();
        return content.snapshot || null;
    } catch (error) {
        console.error("Failed to load voting power snapshot:", error);
        return null;
    }
};
