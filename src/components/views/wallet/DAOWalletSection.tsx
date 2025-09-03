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
            
            const modal = Modal.createDialog(InfoDialog, {
                title: "DAO 지갑 생성 완료",
                description: (
                    <div>
                        <p><strong>{daoName} DAO 전용 지갑이 생성되었습니다!</strong></p>
                        <p>니모닉 문구를 안전하게 보관하세요:</p>
                        <div style={{ 
                            backgroundColor: "#f5f5f5", 
                            padding: "10px", 
                            borderRadius: "4px", 
                            fontFamily: "monospace",
                            wordBreak: "break-all",
                            margin: "10px 0"
                        }}>
                            {newWallet.mnemonic}
                        </div>
                        <p><em>이 문구를 분실하면 지갑을 복원할 수 없습니다.</em></p>
                    </div>
                ),
                button: "확인"
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 생성 실패");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, daoId, daoName]);

    const handleRestoreWallet = useCallback(async () => {
        if (!mnemonic.trim()) {
            setError("니모닉 문구를 입력해주세요");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            if (!wallet.validateMnemonicPhrase(mnemonic.trim())) {
                throw new Error("유효하지 않은 니모닉 문구입니다");
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
            const modal = Modal.createDialog(InfoDialog, {
                title: "DAO 지갑 복구 완료",
                description: (
                    <div>
                        <p><strong>{daoName} DAO 지갑이 복구되었습니다!</strong></p>
                        <p>지갑 주소: <code>{restoredWallet.address}</code></p>
                        <p>복구된 잔액: <strong>{restoredWallet.balance}B</strong></p>
                        {restoredWallet.balance > 0 && (
                            <p><em>원장에서 기존 거래 기록을 바탕으로 잔액을 복구했습니다.</em></p>
                        )}
                    </div>
                ),
                button: "확인"
            });
            
            setShowMnemonicInput(false);
            setMnemonic("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 복원 실패");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, daoId, daoName, mnemonic]);

    const handleExportWallet = useCallback(() => {
        try {
            const exportData = wallet.exportDAOWallet(daoId);
            const blob = new Blob([exportData], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${daoName}-wallet-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 내보내기 실패");
        }
    }, [wallet, daoId, daoName]);

    const formatCurrency = (amount: number): string => {
        return new Intl.NumberFormat().format(amount);
    };

    if (!walletData) {
        return (
            <div className="mx_DAOWalletSection">
                <div className="mx_DAOWalletSection_header">
                    <h3>DAO 지갑</h3>
                    <p>이 DAO 전용 지갑을 생성하거나 복원하세요</p>
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
                            {isLoading ? <Spinner w={16} h={16} /> : "새 지갑 생성"}
                        </AccessibleButton>

                        <AccessibleButton
                            kind="secondary"
                            onClick={() => setShowMnemonicInput(true)}
                            disabled={isLoading}
                            className="mx_DAOWalletSection_restoreButton"
                        >
                            기존 지갑 복원
                        </AccessibleButton>
                    </div>
                ) : (
                    <div className="mx_DAOWalletSection_restore">
                        <Field
                            label="니모닉 문구 (12단어)"
                            placeholder="word1 word2 word3 ..."
                            value={mnemonic}
                            onChange={(e) => setMnemonic(e.target.value)}
                            type="text"
                        />
                        
                        <div className="mx_DAOWalletSection_restoreActions">
                            <AccessibleButton
                                kind="primary"
                                onClick={handleRestoreWallet}
                                disabled={isLoading || !mnemonic.trim()}
                            >
                                {isLoading ? <Spinner w={16} h={16} /> : "복원하기"}
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
    }

    return (
        <div className="mx_DAOWalletSection">
            <div className="mx_DAOWalletSection_header">
                <h3>DAO 지갑</h3>
            </div>

            <div className="mx_DAOWalletSection_walletInfo">
                <div className="mx_DAOWalletSection_address">
                    <span className="mx_DAOWalletSection_label">지갑 주소</span>
                    <div className="mx_DAOWalletSection_addressValue">
                        {walletData.address}
                    </div>
                </div>

                <div className="mx_DAOWalletSection_balance">
                    <span className="mx_DAOWalletSection_label">잔액</span>
                    <div className="mx_DAOWalletSection_balanceValue">
                        {formatCurrency(walletData.balance)} {walletData.currency}
                    </div>
                </div>



                <div className="mx_DAOWalletSection_actions">
                    <AccessibleButton
                        kind="secondary"
                        onClick={handleExportWallet}
                        className="mx_DAOWalletSection_exportButton"
                    >
                        백업
                    </AccessibleButton>

                    <AccessibleButton
                        kind="danger"
                        onClick={() => {
                            if (confirm(`정말로 ${daoName} DAO 지갑을 삭제하시겠습니까? 니모닉이 있어야 복원할 수 있습니다.`)) {
                                wallet.deleteDAOWallet(daoId);
                                setWalletData(null);
                            }
                        }}
                        className="mx_DAOWalletSection_deleteButton"
                    >
                        삭제
                    </AccessibleButton>
                </div>
            </div>
        </div>
    );
};

export default DAOWalletSection;
