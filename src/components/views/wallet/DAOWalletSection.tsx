import React, { useState, useEffect, useCallback } from "react";
import type { Room } from "matrix-js-sdk/src/matrix";
import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import { DAOMnemonicWallet, type DAOWalletData, type DAOWalletSummary } from "../../../utils/DAOMnemonicWallet";
import Modal from "../../../Modal";
import InfoDialog from "../dialogs/InfoDialog";

interface Props {
    space: Room;
}

const DAOWalletSection: React.FC<Props> = ({ space }) => {
    const [walletData, setWalletData] = useState<DAOWalletData | null>(null);
    const [showMnemonicInput, setShowMnemonicInput] = useState(false);
    const [mnemonic, setMnemonic] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const wallet = DAOMnemonicWallet.getInstance();
    const daoId = space.roomId;
    const daoName = space.name;

    const handleWalletUpdate = useCallback((wallets: DAOWalletSummary[]) => {
        const currentWallet = wallets.find(w => w.daoId === daoId);
        if (currentWallet) {
            const fullWallet = wallet.getDAOWallet(daoId);
            setWalletData(fullWallet);
        } else {
            setWalletData(null);
        }
    }, [daoId, wallet]);

    useEffect(() => {
        const existingWallet = wallet.getDAOWallet(daoId);
        setWalletData(existingWallet);

        wallet.addListener(handleWalletUpdate);
        return () => wallet.removeListener(handleWalletUpdate);
    }, [daoId, wallet, handleWalletUpdate]);

    const handleCreateNewWallet = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const newWallet = await wallet.createDAOWallet(daoId, daoName);
            setWalletData(newWallet);
            
            const backupData = `DAO: ${daoId}\nName: ${daoName}\nMnemonic: ${newWallet.mnemonic}\nAddress: ${newWallet.address}\n\n`;
            
            Modal.createDialog(InfoDialog, {
                title: "DAO Wallet Created Successfully",
                description: (
                    <div>
                        <p><strong>Your {daoName} DAO wallet has been created!</strong></p>
                        <p>Please keep the following information safe:</p>
                        <div style={{ 
                            backgroundColor: "#f5f5f5", 
                            padding: "15px", 
                            borderRadius: "4px", 
                            fontFamily: "monospace",
                            wordBreak: "break-all",
                            margin: "10px 0",
                            fontSize: "12px",
                            lineHeight: "1.4"
                        }}>
                            <div><strong>DAO Address:</strong> {daoId}</div>
                            <div><strong>DAO Name:</strong> {daoName}</div>
                            <div><strong>Mnemonic:</strong> {newWallet.mnemonic}</div>
                            <div><strong>Wallet Address:</strong> {newWallet.address}</div>
                        </div>
                        <div style={{ marginTop: "15px" }}>
                            <AccessibleButton
                                kind="primary"
                                onClick={() => {
                                    navigator.clipboard.writeText(backupData);
                                    // 간단한 피드백
                                    const btn = document.activeElement as HTMLElement;
                                    const originalText = btn.textContent;
                                    btn.textContent = "Copied!";
                                    setTimeout(() => {
                                        btn.textContent = originalText;
                                    }, 1000);
                                }}
                                style={{ fontSize: "14px", padding: "8px 16px" }}
                            >
                                Copy All Information
                            </AccessibleButton>
                        </div>
                        <p><em>If you lose this information, you will not be able to restore your wallet.</em></p>
                    </div>
                ),
                button: "OK"
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create wallet");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, daoId, daoName]);

    const handleRestoreWallet = useCallback(async () => {
        if (!mnemonic.trim()) {
            setError("Please enter a mnemonic phrase");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            if (!wallet.validateMnemonicPhrase(mnemonic.trim())) {
                throw new Error("Invalid mnemonic phrase");
            }

            const restoredWallet = await wallet.createDAOWalletFromMnemonic(
                daoId, 
                daoName, 
                "B", 
                1, 
                mnemonic.trim()
            );
            setWalletData(restoredWallet);
            
            // 복구 성공 메시지 표시
            Modal.createDialog(InfoDialog, {
                title: "DAO Wallet Restored Successfully",
                description: (
                    <div>
                        <p><strong>Your {daoName} DAO wallet has been restored!</strong></p>
                        <p>Wallet Address: <code>{restoredWallet.address}</code></p>
                        <p>Restored Balance: <strong>{restoredWallet.balance}B</strong></p>
                        {restoredWallet.balance > 0 && (
                            <p><em>Balance was recovered from existing transaction records in the ledger.</em></p>
                        )}
                    </div>
                ),
                button: "OK"
            });
            
            setShowMnemonicInput(false);
            setMnemonic("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to restore wallet");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, daoId, daoName, mnemonic]);

    const handleExportWallet = useCallback(() => {
        try {
            if (!walletData) {
                throw new Error("Wallet information not found");
            }

            const exportData = `DAO: ${daoId}\nName: ${daoName}\nMnemonic: ${walletData.mnemonic}\nAddress: ${walletData.address}\n\n`;
            
            const blob = new Blob([exportData], { type: "text/plain; charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${daoName}-wallet-${new Date().toISOString().split('T')[0]}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to export wallet");
        }
    }, [walletData, daoId, daoName]);

    const handleShowQRCode = useCallback(async () => {
        if (!walletData) return;

        const QRCodeDialog = await import("../dialogs/QRCodeDialog");
        Modal.createDialog(QRCodeDialog.default, {
            address: walletData.address,
            daoName: daoName,
            space: space,
        });
    }, [walletData, daoName, space]);

    const formatCurrency = (amount: number): string => {
        return new Intl.NumberFormat().format(amount);
    };

    if (!walletData) {
        return (
            <div className="mx_DAOWalletSection">
                <div className="mx_DAOWalletSection_header">
                    <h3>DAO Wallet</h3>
                    <p>Create or restore your dedicated DAO wallet</p>
                </div>

                {error && (
                    <div className="mx_DAOWalletSection_error">
                        {error}
                    </div>
                )}

                {!showMnemonicInput ? (
                    <div className="mx_DAOWalletSection_actions">
                        <AccessibleButton
                            kind="primary"
                            onClick={handleCreateNewWallet}
                            disabled={isLoading}
                            className="mx_DAOWalletSection_createButton"
                        >
                            {isLoading ? <Spinner w={16} h={16} /> : "Create New Wallet"}
                        </AccessibleButton>

                        <AccessibleButton
                            kind="secondary"
                            onClick={() => setShowMnemonicInput(true)}
                            disabled={isLoading}
                            className="mx_DAOWalletSection_restoreButton"
                        >
                            Restore Existing Wallet
                        </AccessibleButton>
                    </div>
                ) : (
                    <div className="mx_DAOWalletSection_restore">
                        <Field
                            label="Mnemonic Phrase (12 words)"
                            placeholder="word1 word2 word3 ..."
                            value={mnemonic}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMnemonic(e.target.value)}
                            type="text"
                        />
                        
                        <div className="mx_DAOWalletSection_restoreActions">
                            <AccessibleButton
                                kind="primary"
                                onClick={handleRestoreWallet}
                                disabled={isLoading || !mnemonic.trim()}
                            >
                                {isLoading ? <Spinner w={16} h={16} /> : "Restore"}
                            </AccessibleButton>
                            
                            <AccessibleButton
                                kind="secondary"
                                onClick={() => {
                                    setShowMnemonicInput(false);
                                    setMnemonic("");
                                    setError(null);
                                }}
                                disabled={isLoading}
                            >
                                Cancel
                            </AccessibleButton>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="mx_DAOWalletSection">
            <div className="mx_DAOWalletSection_header">
                <h3>DAO Wallet: {daoName} Network</h3>
            </div>

            <div className="mx_DAOWalletSection_walletInfo">
                <div className="mx_DAOWalletSection_address">
                    <span className="mx_DAOWalletSection_label">Address</span>
                    <div className="mx_DAOWalletSection_addressRow">
                        <div className="mx_DAOWalletSection_addressValue">
                            {walletData.address}
                        </div>
                        <a
                            href="#"
                            className="mx_DAOWalletSection_copyLink"
                            onClick={(e) => {
                                e.preventDefault();
                                navigator.clipboard.writeText(walletData.address);
                                // 간단한 피드백
                                const element = e.currentTarget as HTMLElement;
                                const originalText = element.textContent;
                                element.textContent = "Copied!";
                                setTimeout(() => {
                                    element.textContent = originalText;
                                }, 1000);
                            }}
                        >
                            Copy
                        </a>
                    </div>
                </div>

                <div className="mx_DAOWalletSection_balance">
                    <span className="mx_DAOWalletSection_label">Balance</span>
                    <div className="mx_DAOWalletSection_balanceValue">
                        {formatCurrency(walletData.balance)} {walletData.currency}
                    </div>
                </div>

                <div className="mx_DAOWalletSection_actions">
                    <a
                        href="#"
                        className="mx_DAOWalletSection_actionLink"
                        onClick={(e) => {
                            e.preventDefault();
                            handleExportWallet();
                        }}
                    >
                        Backup
                    </a>

                    <a
                        href="#"
                        className="mx_DAOWalletSection_actionLink mx_DAOWalletSection_deleteLink"
                        onClick={(e) => {
                            e.preventDefault();
                            if (confirm(`Are you sure you want to delete the ${daoName} DAO wallet? You will need the mnemonic phrase to restore it.`)) {
                                wallet.deleteDAOWallet(daoId);
                                setWalletData(null);
                            }
                        }}
                    >
                        Delete
                    </a>

                    <a
                        href="#"
                        className="mx_DAOWalletSection_actionLink"
                        onClick={(e) => {
                            e.preventDefault();
                            handleShowQRCode();
                        }}
                    >
                        QR
                    </a>
                </div>
            </div>
        </div>
    );
};

export default DAOWalletSection;
