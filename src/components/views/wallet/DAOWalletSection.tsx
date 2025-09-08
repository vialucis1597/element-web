import React, { useState, useEffect, useCallback } from "react";
import type { Room } from "matrix-js-sdk/src/matrix";
import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import { DAOMnemonicWallet, type DAOWalletData, type DAOWalletSummary } from "../../../utils/DAOMnemonicWallet";
import { DAOContributionTracker } from "../../../utils/DAOContributionTracker";
import Modal from "../../../Modal";
import InfoDialog from "../dialogs/InfoDialog";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import SpaceStore from "../../../stores/spaces/SpaceStore";

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
        console.log(`🔄 DAOWalletSection: Wallet update received for ${daoName}`, wallets);
        const currentWallet = wallets.find(w => w.daoId === daoId);
        if (currentWallet) {
            // Force fresh fetch from wallet with immediate state update
            const fullWallet = wallet.getDAOWallet(daoId);
            console.log(`💰 DAOWalletSection: Updated wallet data for ${daoName}:`, fullWallet);
            console.log(`💰 DAOWalletSection: Current balance: ${fullWallet?.balance}B`);
            
            // Force re-render by setting to null first, then to new data
            setWalletData(null);
            setTimeout(() => {
                setWalletData(fullWallet);
                console.log(`✅ DAOWalletSection: State updated for ${daoName}`);
            }, 10);
        } else {
            console.log(`❌ DAOWalletSection: No wallet found for ${daoName}`);
            setWalletData(null);
        }
    }, [daoId, daoName, wallet]);

    useEffect(() => {
        const existingWallet = wallet.getDAOWallet(daoId);
        
        if (existingWallet) {
            setWalletData(existingWallet);
        } else {
            // 현재 DAO에 지갑이 없지만 다른 DAO에 지갑이 있는 경우 자동 연결
            const allWallets = wallet.getAllDAOWallets();
            if (allWallets.length > 0) {
                const firstWallet = wallet.getDAOWallet(allWallets[0].daoId);
                if (firstWallet) {
                    // 기존 지갑의 니모닉으로 현재 DAO에 지갑 생성
                    wallet.createDAOWalletFromMnemonic(
                        daoId,
                        daoName,
                        "B",
                        1,
                        firstWallet.mnemonic
                    ).then((newWallet) => {
                        setWalletData(newWallet);
                        console.log(`Auto-connected wallet to ${daoName}`);
                    }).catch((err) => {
                        console.warn(`Failed to auto-connect wallet to ${daoName}:`, err);
                    });
                }
            }
        }

        wallet.addListener(handleWalletUpdate);
        return () => wallet.removeListener(handleWalletUpdate);
    }, [daoId, daoName, wallet, handleWalletUpdate]);

    const handleCreateNewWallet = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            // 먼저 현재 DAO에 지갑 생성
            const newWallet = await wallet.createDAOWallet(daoId, daoName);
            setWalletData(newWallet);

            // 모든 다른 DAO에도 동일한 지갑 연결
            const client = MatrixClientPeg.safeGet();
            const allSpaces = SpaceStore.instance.spacePanelSpaces.filter(space => 
                space.name && space.roomId.startsWith('!') && space.roomId !== daoId
            );

            for (const space of allSpaces) {
                try {
                    await wallet.createDAOWalletFromMnemonic(
                        space.roomId,
                        space.name,
                        "B",
                        1,
                        newWallet.mnemonic
                    );
                } catch (err) {
                    console.warn(`Failed to create wallet for ${space.name}:`, err);
                }
            }
            
            const backupData = `Mnemonic: ${newWallet.mnemonic}\nAddress: ${newWallet.address}`;
            
            Modal.createDialog(InfoDialog, {
                title: "지갑 생성 완료",
                description: (
                    <div>
                        <p><strong>마이월렛이 생성되었습니다!</strong></p>
                        <p>모든 DAO에서 동일한 지갑을 사용할 수 있습니다.</p>
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
                            <div><strong>지갑 주소:</strong> {newWallet.address}</div>
                            <div><strong>니모닉:</strong> {newWallet.mnemonic}</div>
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
                        <p><em>니모닉 문구를 안전한 곳에 보관하세요.</em></p>
                    </div>
                ),
                button: "확인"
            });

            DAOContributionTracker.getInstance().initialize();
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

            // 현재 DAO에 지갑 복구
            const restoredWallet = await wallet.createDAOWalletFromMnemonic(
                daoId, 
                daoName, 
                "B", 
                1, 
                mnemonic.trim()
            );
            setWalletData(restoredWallet);

            // 모든 다른 DAO에도 동일한 지갑 연결
            const client = MatrixClientPeg.safeGet();
            const allSpaces = SpaceStore.instance.spacePanelSpaces.filter(space => 
                space.name && space.roomId.startsWith('!') && space.roomId !== daoId
            );

            for (const space of allSpaces) {
                try {
                    await wallet.createDAOWalletFromMnemonic(
                        space.roomId,
                        space.name,
                        "B",
                        1,
                        mnemonic.trim()
                    );
                } catch (err) {
                    console.warn(`Failed to restore wallet for ${space.name}:`, err);
                }
            }
            
            // 복구 성공 메시지 표시
            Modal.createDialog(InfoDialog, {
                title: "지갑 복구 완료",
                description: (
                    <div>
                        <p><strong>마이월렛이 복구되었습니다!</strong></p>
                        <p>모든 DAO에서 동일한 지갑을 사용할 수 있습니다.</p>
                        <p>지갑 주소: <code>{restoredWallet.address}</code></p>
                        <p>복구된 잔액: <strong>{restoredWallet.balance}B</strong></p>
                        {restoredWallet.balance > 0 && (
                            <p><em>원장에서 기존 거래 기록을 바탕으로 잔액을 복구했습니다.</em></p>
                        )}
                    </div>
                ),
                button: "확인"
            });

            DAOContributionTracker.getInstance().initialize();
            
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

    const handleDeleteAllWallets = useCallback(() => {
        if (!walletData) return;

        const confirmed = confirm(
            `Are you sure you want to delete your wallet?\n\nAll DAO wallets will be deleted and can only be recovered with your mnemonic phrase.`
        );

        if (confirmed) {
            try {
                // 모든 DAO의 지갑 삭제
                const allWallets = wallet.getAllDAOWallets();
                allWallets.forEach(walletSummary => {
                    wallet.deleteDAOWallet(walletSummary.daoId);
                });

                setWalletData(null);
                
                Modal.createDialog(InfoDialog, {
                    title: "Wallet Deleted Successfully",
                    description: "All DAO wallets have been deleted. You can recover them anytime with your mnemonic phrase.",
                    button: "확인"
                });
            } catch (err) {
                console.error("Failed to delete wallets:", err);
                Modal.createDialog(InfoDialog, {
                    title: "Deletion Failed",
                    description: "An error occurred while deleting the wallet.",
                    button: "확인"
                });
            }
        }
    }, [walletData, wallet]);

    const formatCurrency = (amount: number): string => {
        return new Intl.NumberFormat().format(amount);
    };

    const handleSendClick = useCallback(async () => {
        if (!walletData) return;

        console.log(`💸 Opening send dialog for ${daoName}`);
        
        const SendTokenDialog = await import("../dialogs/SendTokenDialog");
        Modal.createDialog(SendTokenDialog.default, {
            daoId: daoId,
            daoName: daoName,
            senderAddress: walletData.address,
            maxBalance: walletData.balance,
            currency: walletData.currency,
        });
    }, [walletData, daoId, daoName]);

    const handleHistoryClick = useCallback(async () => {
        if (!walletData) return;
        
        console.log(`📜 Opening transaction history for ${daoName}`);
        const TransactionHistoryDialog = await import("../dialogs/TransactionHistoryDialog");
        Modal.createDialog(TransactionHistoryDialog.default, {
            daoId: daoId,
            daoName: daoName,
            walletAddress: walletData.address,
        });
    }, [walletData, daoId, daoName]);

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
                <h3>Balance: {daoName} DAO</h3>
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
                            handleDeleteAllWallets();
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

                    <AccessibleButton
                        kind="secondary"
                        className="mx_DAOWalletSection_historyButton"
                        onClick={handleHistoryClick}
                        style={{ marginLeft: "auto", marginRight: "8px" }}
                    >
                        History
                    </AccessibleButton>

                    <AccessibleButton
                        kind="primary"
                        className="mx_DAOWalletSection_sendButton"
                        onClick={handleSendClick}
                    >
                        Send
                    </AccessibleButton>
                </div>
            </div>
        </div>
    );
};

export default DAOWalletSection;
