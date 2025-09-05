/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, useEffect, useCallback } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import { DAOMnemonicWallet, type DAOWalletSummary } from "../../../utils/DAOMnemonicWallet";
import { DAOContributionTracker } from "../../../utils/DAOContributionTracker";
import Modal from "../../../Modal";
import InfoDialog from "../dialogs/InfoDialog";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import SpaceStore from "../../../stores/spaces/SpaceStore";

interface Props {
    onClose?: () => void;
}

const MyWalletPanel: React.FC<Props> = ({ onClose }) => {
    const [hasWallet, setHasWallet] = useState(false);
    const [walletData, setWalletData] = useState<any>(null);
    const [walletSummaries, setWalletSummaries] = useState<DAOWalletSummary[]>([]);
    const [mnemonic, setMnemonic] = useState("");
    const [showMnemonicInput, setShowMnemonicInput] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [allSpaces, setAllSpaces] = useState<Room[]>([]);

    const wallet = DAOMnemonicWallet.getInstance();

    const handleWalletUpdate = useCallback((newWalletSummaries: DAOWalletSummary[]) => {
        setWalletSummaries(newWalletSummaries);
        setHasWallet(newWalletSummaries.length > 0);
        
        // 첫 번째 지갑의 정보를 메인 지갑으로 사용 (모든 지갑이 동일하므로)
        if (newWalletSummaries.length > 0) {
            const firstWalletId = newWalletSummaries[0].daoId;
            const mainWallet = wallet.getDAOWallet(firstWalletId);
            setWalletData(mainWallet);
        } else {
            setWalletData(null);
        }
    }, [wallet]);

    useEffect(() => {
        const existingWallets = wallet.getAllDAOWallets();
        setWalletSummaries(existingWallets);
        setHasWallet(existingWallets.length > 0);

        // 첫 번째 지갑의 정보를 메인 지갑으로 사용
        if (existingWallets.length > 0) {
            const firstWalletId = existingWallets[0].daoId;
            const mainWallet = wallet.getDAOWallet(firstWalletId);
            setWalletData(mainWallet);
        }

        // Get all DAO spaces
        const client = MatrixClientPeg.safeGet();
        const spaces = SpaceStore.instance.spacePanelSpaces.filter(space => 
            space.name && space.roomId.startsWith('!')
        );
        setAllSpaces(spaces);

        wallet.addListener(handleWalletUpdate);
        return () => wallet.removeListener(handleWalletUpdate);
    }, [wallet, handleWalletUpdate]);

    const handleCreateNewWallet = useCallback(async () => {
        if (allSpaces.length === 0) {
            setError("DAO 스페이스가 없습니다. 먼저 DAO 스페이스에 가입하세요.");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Create wallet for all available DAO spaces
            const firstSpace = allSpaces[0];
            const newWallet = await wallet.createDAOWallet(firstSpace.roomId, firstSpace.name);
            
            // Copy the same wallet to all other DAO spaces
            for (let i = 1; i < allSpaces.length; i++) {
                const space = allSpaces[i];
                await wallet.createDAOWalletFromMnemonic(
                    space.roomId,
                    space.name,
                    "B",
                    1,
                    newWallet.mnemonic
                );
            }

            Modal.createDialog(InfoDialog, {
                title: "지갑 생성 완료",
                description: (
                    <div>
                        <p><strong>마이월렛이 생성되었습니다!</strong></p>
                        <p>모든 DAO에서 동일한 지갑을 사용할 수 있습니다.</p>
                        <p>지갑 주소: <code>{newWallet.address}</code></p>
                        <p><em>니모닉 문구를 안전한 곳에 보관하세요.</em></p>
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
                            <div><strong>니모닉:</strong> {newWallet.mnemonic}</div>
                        </div>
                    </div>
                ),
                button: "확인"
            });

            DAOContributionTracker.getInstance().initialize();
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 생성 실패");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, allSpaces]);

    const handleRestoreWallet = useCallback(async () => {
        if (!mnemonic.trim()) {
            setError("니모닉 문구를 입력해주세요");
            return;
        }

        if (allSpaces.length === 0) {
            setError("DAO 스페이스가 없습니다. 먼저 DAO 스페이스에 가입하세요.");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            if (!wallet.validateMnemonicPhrase(mnemonic.trim())) {
                throw new Error("유효하지 않은 니모닉 문구입니다");
            }

            // Restore wallet for all available DAO spaces
            for (const space of allSpaces) {
                await wallet.createDAOWalletFromMnemonic(
                    space.roomId,
                    space.name,
                    "B",
                    1,
                    mnemonic.trim()
                );
            }

            Modal.createDialog(InfoDialog, {
                title: "지갑 복구 완료",
                description: (
                    <div>
                        <p><strong>마이월렛이 복구되었습니다!</strong></p>
                        <p>모든 DAO에서 동일한 지갑을 사용할 수 있습니다.</p>
                        <p><em>원장에서 기존 거래 기록을 바탕으로 잔액을 복구했습니다.</em></p>
                    </div>
                ),
                button: "확인"
            });

            DAOContributionTracker.getInstance().initialize();
            
            setShowMnemonicInput(false);
            setMnemonic("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 복원 실패");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, mnemonic, allSpaces]);

    const handleExportWallet = useCallback(() => {
        try {
            if (!walletData) {
                throw new Error("지갑 정보를 찾을 수 없습니다");
            }

            const exportData = `My Wallet Backup\nAddress: ${walletData.address}\nMnemonic: ${walletData.mnemonic}\n\n`;
            
            const blob = new Blob([exportData], { type: "text/plain; charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `my-wallet-backup-${new Date().toISOString().split('T')[0]}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Failed to export wallet:", err);
        }
    }, [walletData]);

    const handleDeleteAllWallets = useCallback(() => {
        if (!walletData) return;

        const confirmed = confirm(
            `정말로 마이월렛을 삭제하시겠습니까?\n\n모든 DAO의 지갑이 삭제되며, 니모닉 문구가 있어야만 복구할 수 있습니다.`
        );

        if (confirmed) {
            try {
                // 모든 DAO의 지갑 삭제
                const allWallets = wallet.getAllDAOWallets();
                allWallets.forEach(walletSummary => {
                    wallet.deleteDAOWallet(walletSummary.daoId);
                });

                setWalletData(null);
                setWalletSummaries([]);
                setHasWallet(false);
                
                Modal.createDialog(InfoDialog, {
                    title: "지갑 삭제 완료",
                    description: "모든 DAO의 지갑이 삭제되었습니다. 니모닉 문구로 언제든지 복구할 수 있습니다.",
                    button: "확인"
                });
            } catch (err) {
                console.error("Failed to delete wallets:", err);
            }
        }
    }, [walletData, wallet]);

    const handleShowQRCode = useCallback(async () => {
        if (!walletData) return;

        const QRCodeDialog = await import("../dialogs/QRCodeDialog");
        Modal.createDialog(QRCodeDialog.default, {
            address: walletData.address,
            daoName: "My Wallet",
            space: null,
        });
    }, [walletData]);

    const formatCurrency = (amount: number): string => {
        return new Intl.NumberFormat().format(amount);
    };

    const renderWalletInfo = () => {
        if (!walletData) return null;

        return (
            <div className="mx_MyWalletPanel_walletInfo">
                <h3>MY Wallet</h3>
                <div className="mx_MyWalletPanel_address">
                    <span className="mx_MyWalletPanel_label">Address</span>
                    <div className="mx_MyWalletPanel_addressRow">
                        <div className="mx_MyWalletPanel_addressValue">
                            {walletData.address}
                        </div>
                        <a
                            href="#"
                            className="mx_MyWalletPanel_copyLink"
                            onClick={(e) => {
                                e.preventDefault();
                                navigator.clipboard.writeText(walletData.address);
                                const element = e.currentTarget as HTMLElement;
                                const originalText = element.textContent;
                                element.textContent = "복사됨!";
                                setTimeout(() => {
                                    element.textContent = originalText;
                                }, 1000);
                            }}
                        >
                            Copy
                        </a>
                    </div>
                </div>
                
                <div className="mx_MyWalletPanel_actions">
                    <a
                        href="#"
                        className="mx_MyWalletPanel_actionLink"
                        onClick={(e) => {
                            e.preventDefault();
                            handleExportWallet();
                        }}
                    >
                        Backup
                    </a>
                    <a
                        href="#"
                        className="mx_MyWalletPanel_actionLink mx_MyWalletPanel_deleteLink"
                        onClick={(e) => {
                            e.preventDefault();
                            handleDeleteAllWallets();
                        }}
                    >
                        Delete
                    </a>
                    <a
                        href="#"
                        className="mx_MyWalletPanel_actionLink"
                        onClick={(e) => {
                            e.preventDefault();
                            handleShowQRCode();
                        }}
                    >
                        QR
                    </a>
                </div>
            </div>
        );
    };

    const renderBalanceCards = () => {
        if (walletSummaries.length === 0) return null;

        return (
            <div className="mx_MyWalletPanel_balanceList">
                <h4>DAO Balance</h4>
                {walletSummaries.map((summary) => (
                    <div key={summary.daoId} className="mx_MyWalletPanel_balanceCard">
                        <div className="mx_MyWalletPanel_balanceHeader">
                            <div className="mx_MyWalletPanel_daoInfo">
                                <div className="mx_MyWalletPanel_daoName">{summary.daoName} Network</div>
                            </div>
                            <div className="mx_MyWalletPanel_balanceAmount">
                                {formatCurrency(summary.balance)} {summary.currency}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderContent = () => {
        if (hasWallet) {
            return (
                <>
                    {renderWalletInfo()}
                    {renderBalanceCards()}
                </>
            );
        }

        return (
            <div className="mx_MyWalletPanel_card">
                <h3>마이월렛</h3>
                <p>지갑을 생성하거나 기존 지갑을 복구하세요</p>
                
                {error && (
                    <div className="mx_MyWalletPanel_error">
                        {error}
                    </div>
                )}

                {!showMnemonicInput ? (
                    <>
                        <AccessibleButton
                            kind="primary"
                            onClick={handleCreateNewWallet}
                            disabled={isLoading}
                            className="mx_MyWalletPanel_createButton"
                        >
                            {isLoading ? <Spinner w={16} h={16} /> : "Create New Wallet"}
                        </AccessibleButton>

                        <AccessibleButton
                            kind="link"
                            onClick={() => setShowMnemonicInput(true)}
                            disabled={isLoading}
                            className="mx_MyWalletPanel_restoreButton"
                        >
                            Restore Existing Wallet
                        </AccessibleButton>
                    </>
                ) : (
                    <div className="mx_MyWalletPanel_restoreForm">
                        <Field
                            label="니모닉 문구 (12단어)"
                            placeholder="word1 word2 word3 ..."
                            value={mnemonic}
                            onChange={(e) => setMnemonic(e.target.value)}
                            type="text"
                        />
                        
                        <div className="mx_MyWalletPanel_restoreActions">
                            <AccessibleButton
                                kind="primary"
                                onClick={handleRestoreWallet}
                                disabled={isLoading || !mnemonic.trim()}
                            >
                                {isLoading ? <Spinner w={16} h={16} /> : "복구하기"}
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
                                취소
                            </AccessibleButton>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="mx_MyWalletPanel">
            {renderContent()}
        </div>
    );
};

export default MyWalletPanel;
