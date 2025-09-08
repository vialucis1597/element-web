/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { DAOMnemonicWallet } from "./DAOMnemonicWallet";
import SpaceStore from "../stores/spaces/SpaceStore";

export interface GOVSettings {
    bTokenRequired: number;
}

/**
 * Get GOV settings from a space
 */
export const getGOVSettings = async (cli: MatrixClient, spaceId: string): Promise<GOVSettings | null> => {
    try {
        const room = cli.getRoom(spaceId);
        if (!room) return null;

        const stateEvent = room.currentState.getStateEvents("org.matrix.msc3381.space.gov_settings", "");
        if (!stateEvent) return null;

        const content = stateEvent.getContent();
        return content.settings || null;
    } catch (error) {
        console.error("Failed to get GOV settings:", error);
        return null;
    }
};

/**
 * Check if user has enough B tokens to create agenda
 */
export const checkBTokenBalance = async (cli: MatrixClient, userId: string, spaceId?: string): Promise<number> => {
    try {
        console.log(`Checking B token balance for user: ${userId}, spaceId: ${spaceId}`);
        
        // Get the GOV space room to find its parent DAO
        const govSpaceRoom = spaceId ? cli.getRoom(spaceId) : null;
        if (!govSpaceRoom) {
            console.log("No GOV space room found");
            return 0;
        }
        
        console.log(`GOV space: ${govSpaceRoom.name} (${govSpaceRoom.roomId})`);
        
        // Find the parent DAO space (the space that contains this GOV space)
        const parentSpaces = SpaceStore.instance.getParents(govSpaceRoom.roomId);
        if (parentSpaces.length === 0) {
            console.log("No parent DAO found for GOV space");
            return 0;
        }
        
        const parentDAOSpace = parentSpaces[0];
        const parentDAORoom = cli.getRoom(parentDAOSpace.roomId);
        if (!parentDAORoom) {
            console.log("Parent DAO room not found");
            return 0;
        }
        
        console.log(`Parent DAO: ${parentDAORoom.name} (${parentDAORoom.roomId})`);
        
        // Get DAO wallet instance
        const daoWallet = DAOMnemonicWallet.getInstance();
        
        // Get user's wallet address from any existing DAO wallet
        const daoWallets = daoWallet.getAllDAOWallets();
        if (daoWallets.length === 0) {
            console.log("No DAO wallets found for user");
            return 0;
        }
        
        // Use the first wallet's address (all wallets should have the same address for the same user)
        const userWalletAddress = daoWallets[0].address;
        console.log(`User wallet address: ${userWalletAddress}`);
        
        // Get balance from the parent DAO's ledger
        const balance = await daoWallet.recoverBalanceFromLedger(parentDAORoom.roomId, userWalletAddress);
        console.log(`Balance in DAO ${parentDAORoom.name}: ${balance}B`);
        
        // Simulate API delay for realistic UX
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        return balance;
    } catch (error) {
        console.error("Failed to check B token balance:", error);
        return 0;
    }
};

/**
 * Check if user can create agenda based on B token requirement
 */
export const canCreateAgenda = async (cli: MatrixClient, spaceId: string, userId: string): Promise<{
    canCreate: boolean;
    required: number;
    current: number;
    message?: string;
}> => {
    try {
        const settings = await getGOVSettings(cli, spaceId);
        if (!settings) {
            return {
                canCreate: true, // No restrictions if no settings
                required: 0,
                current: 0,
            };
        }

        const currentBalance = await checkBTokenBalance(cli, userId, spaceId);
        const canCreate = currentBalance >= settings.bTokenRequired;

        return {
            canCreate,
            required: settings.bTokenRequired,
            current: currentBalance,
            message: canCreate 
                ? undefined 
                : `You need at least ${settings.bTokenRequired}B tokens to create an agenda. Current balance: ${currentBalance.toFixed(2)}B`,
        };
    } catch (error) {
        console.error("Failed to check agenda creation permission:", error);
        return {
            canCreate: false,
            required: 0,
            current: 0,
            message: "Failed to verify token balance",
        };
    }
};
