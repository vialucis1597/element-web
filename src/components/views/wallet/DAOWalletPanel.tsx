import React, { useState, useEffect, useCallback } from "react";
import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import { DAOMnemonicWallet, type DAOWalletSummary } from "../../../utils/DAOMnemonicWallet";
import { DAOContributionTracker } from "../../../utils/DAOContributionTracker";
import Modal from "../../../Modal";
import InfoDialog from "../dialogs/InfoDialog";

interface Props {
    onClose?: () => void;
}

const DAOWalletPanel: React.FC<Props> = ({ onClose }) => {
    const [walletSummaries, setWalletSummaries] = useState<DAOWalletSummary[]>([]);
    const [mnemonic, setMnemonic] = useState("");
    const [selectedDaoId, setSelectedDaoId] = useState<string>("");
    const [showMnemonicInput, setShowMnemonicInput] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);

    const wallet = DAOMnemonicWallet.getInstance();

    const handleWalletUpdate = useCallback((newWalletSummaries: DAOWalletSummary[]) => {
        setWalletSummaries(newWalletSummaries);
    }, []);

    useEffect(() => {
        const existingWallets = wallet.getAllDAOWallets();
        setWalletSummaries(existingWallets);

        wallet.addListener(handleWalletUpdate);
        return () => wallet.removeListener(handleWalletUpdate);
    }, [wallet, handleWalletUpdate]);

    const handleRestoreWallet = useCallback(async () => {
        if (!mnemonic.trim() || !selectedDaoId) {
            setError("니모닉 문구와 DAO를 선택해주세요");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            if (!wallet.validateMnemonicPhrase(mnemonic.trim())) {
                throw new Error("유효하지 않은 니모닉 문구입니다");
            }

            const restoredWallet = await wallet.createDAOWalletFromMnemonic(
                selectedDaoId,
                `Restored DAO ${selectedDaoId.substring(0, 8)}`,
                "B",
                1,
                mnemonic.trim()
            );

            // 복구 성공 알림
            Modal.createDialog(InfoDialog, {
                title: "DAO 지갑 복구 완료",
                description: (
                    <div>
                        <p><strong>DAO 지갑이 복구되었습니다!</strong></p>
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
            setSelectedDaoId("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 복원 실패");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, mnemonic, selectedDaoId]);

    const handleExportWallet = useCallback((daoId: string, daoName: string) => {
        try {
            const daoWallet = wallet.getDAOWallet(daoId);
            if (!daoWallet) {
                throw new Error("지갑 정보를 찾을 수 없습니다");
            }

            const exportData = `DAO: ${daoId}\nName: ${daoName}\nMnemonic: ${daoWallet.mnemonic}\nAddress: ${daoWallet.address}\n\n`;
            
            const blob = new Blob([exportData], { type: "text/plain; charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${daoName}-wallet-${new Date().toISOString().split('T')[0]}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 내보내기 실패");
        }
    }, [wallet]);

    const formatCurrency = (amount: number): string => {
        return new Intl.NumberFormat().format(amount);
    };

    const handleImportWallets = useCallback(async () => {
        setIsImporting(true);
        setError(null);

        try {
            // 파일 선택 다이얼로그 열기
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.txt,.json';
            input.multiple = false;

            input.onchange = async (event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const importedWallets = parseWalletBackupFile(text);
                    
                    if (importedWallets.length === 0) {
                        throw new Error("유효한 지갑 정보를 찾을 수 없습니다");
                    }

                    // 각 지갑을 순차적으로 복원
                    let successCount = 0;
                    const errors: string[] = [];

                    for (const walletInfo of importedWallets) {
                        try {
                            await wallet.createDAOWalletFromMnemonic(
                                walletInfo.daoId,
                                walletInfo.daoName,
                                "B",
                                1,
                                walletInfo.mnemonic
                            );
                            successCount++;
                        } catch (err) {
                            errors.push(`${walletInfo.daoName}: ${err instanceof Error ? err.message : "복원 실패"}`);
                        }
                    }

                    // 결과 알림
                    const resultMessage = `
                        ${successCount}개의 DAO 지갑이 성공적으로 복원되었습니다.
                        ${errors.length > 0 ? `\n\n실패한 지갑:\n${errors.join('\n')}` : ''}
                    `;

                    Modal.createDialog(InfoDialog, {
                        title: "지갑 가져오기 완료",
                        description: resultMessage,
                        button: "확인"
                    });

                    DAOContributionTracker.getInstance().initialize();
                } catch (err) {
                    setError(err instanceof Error ? err.message : "파일 처리 실패");
                } finally {
                    setIsImporting(false);
                }
            };

            input.click();
        } catch (err) {
            setError(err instanceof Error ? err.message : "파일 선택 실패");
            setIsImporting(false);
        }
    }, [wallet]);

    // 백업 파일 파싱 함수
    const parseWalletBackupFile = (text: string): Array<{daoId: string, daoName: string, mnemonic: string}> => {
        const wallets: Array<{daoId: string, daoName: string, mnemonic: string}> = [];
        const lines = text.split('\n');
        
        let currentWallet: Partial<{daoId: string, daoName: string, mnemonic: string}> = {};
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('DAO:')) {
                // 이전 지갑 정보가 완성되었으면 추가
                if (currentWallet.daoId && currentWallet.daoName && currentWallet.mnemonic) {
                    wallets.push(currentWallet as {daoId: string, daoName: string, mnemonic: string});
                }
                currentWallet = { daoId: trimmedLine.substring(4).trim() };
            } else if (trimmedLine.startsWith('Name:')) {
                currentWallet.daoName = trimmedLine.substring(5).trim();
            } else if (trimmedLine.startsWith('Mnemonic:')) {
                currentWallet.mnemonic = trimmedLine.substring(9).trim();
            }
        }
        
        // 마지막 지갑 정보 추가
        if (currentWallet.daoId && currentWallet.daoName && currentWallet.mnemonic) {
            wallets.push(currentWallet as {daoId: string, daoName: string, mnemonic: string});
        }
        
        return wallets;
    };

    const renderWalletList = () => {
        if (walletSummaries.length === 0) {
            return (
                <div className="mx_DAOWalletPanel_emptyState">
                    <p>아직 생성된 DAO 지갑이 없습니다.</p>
                    <p>DAO 스페이스에 가서 지갑을 생성하거나 기존 지갑을 복원하세요.</p>
                </div>
            );
        }

        return (
            <div className="mx_DAOWalletPanel_walletList">
                <h4>DAO별 지갑</h4>
                {walletSummaries.map((summary) => (
                    <div key={summary.daoId} className="mx_DAOWalletPanel_walletItem">
                        <div className="mx_DAOWalletPanel_walletHeader">
                            <div className="mx_DAOWalletPanel_daoInfo">
                                <div className="mx_DAOWalletPanel_daoName">{summary.daoName}</div>
                                <div className="mx_DAOWalletPanel_daoId">{summary.daoId.substring(0, 8)}...</div>
                            </div>
                            <div className="mx_DAOWalletPanel_walletActions">
                                <AccessibleButton
                                    kind="secondary"
                                    onClick={() => handleExportWallet(summary.daoId, summary.daoName)}
                                    className="mx_DAOWalletPanel_exportButton"
                                >
                                    백업
                                </AccessibleButton>
                                <AccessibleButton
                                    kind="danger"
                                    onClick={() => {
                                        if (confirm(`Are you sure you want to delete the ${summary.daoName} DAO wallet?`)) {
                                            wallet.deleteDAOWallet(summary.daoId);
                                        }
                                    }}
                                    className="mx_DAOWalletPanel_deleteButton"
                                >
                                    Delete
                                </AccessibleButton>
                            </div>
                        </div>
                        
                        <div className="mx_DAOWalletPanel_walletDetails">
                            <div className="mx_DAOWalletPanel_detail">
                                <span className="mx_DAOWalletPanel_label">주소:</span>
                                <span className="mx_DAOWalletPanel_value">{summary.address}</span>
                            </div>
                            <div className="mx_DAOWalletPanel_detail">
                                <span className="mx_DAOWalletPanel_label">잔액:</span>
                                <span className="mx_DAOWalletPanel_value">{formatCurrency(summary.balance)} {summary.currency}</span>
                            </div>

                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderRestoreSection = () => {
        return (
            <div className="mx_DAOWalletPanel_restore">
                <h4>지갑 복원</h4>
                <p>기존 DAO 지갑의 니모닉 문구로 지갑을 복원할 수 있습니다.</p>
                
                {error && (
                    <div className="mx_DAOWalletPanel_error">
                        {error}
                    </div>
                )}

                {!showMnemonicInput ? (
                    <AccessibleButton
                        kind="secondary"
                        onClick={() => setShowMnemonicInput(true)}
                        disabled={isLoading}
                        className="mx_DAOWalletPanel_restoreButton"
                    >
                        기존 지갑 복원
                    </AccessibleButton>
                ) : (
                    <div className="mx_DAOWalletPanel_restoreForm">
                        <Field
                            label="DAO ID (룸 ID)"
                            placeholder="!daospaceid:example.com"
                            value={selectedDaoId}
                            onChange={(e) => setSelectedDaoId(e.target.value)}
                            type="text"
                        />
                        
                        <Field
                            label="니모닉 문구 (12단어)"
                            placeholder="word1 word2 word3 ..."
                            value={mnemonic}
                            onChange={(e) => setMnemonic(e.target.value)}
                            type="text"
                        />
                        
                        <div className="mx_DAOWalletPanel_restoreActions">
                            <AccessibleButton
                                kind="primary"
                                onClick={handleRestoreWallet}
                                disabled={isLoading || !mnemonic.trim() || !selectedDaoId.trim()}
                            >
                                {isLoading ? <Spinner w={16} h={16} /> : "복원하기"}
                            </AccessibleButton>
                            
                            <AccessibleButton
                                kind="secondary"
                                onClick={() => {
                                    setShowMnemonicInput(false);
                                    setMnemonic("");
                                    setSelectedDaoId("");
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

    const totalBalance = walletSummaries.reduce((sum, wallet) => sum + wallet.balance, 0);

    return (
        <div className="mx_DAOWalletPanel">
            <div className="mx_DAOWalletPanel_header">
                <h2>DAO 지갑 관리</h2>
                {onClose && (
                    <AccessibleButton
                        kind="icon"
                        onClick={onClose}
                        className="mx_DAOWalletPanel_closeButton"
                        aria-label="닫기"
                    >
                        ✕
                    </AccessibleButton>
                )}
            </div>

            <div className="mx_DAOWalletPanel_content">
                <div className="mx_DAOWalletPanel_summary">
                    <div className="mx_DAOWalletPanel_summaryHeader">
                        <h3>전체 현황</h3>
                        <AccessibleButton
                            kind="primary"
                            onClick={handleImportWallets}
                            disabled={isImporting}
                            className="mx_DAOWalletPanel_importButton"
                        >
                            {isImporting ? <Spinner w={16} h={16} /> : "지갑 가져오기"}
                        </AccessibleButton>
                    </div>
                    <div className="mx_DAOWalletPanel_totalInfo">
                        <div className="mx_DAOWalletPanel_stat">
                            <span className="mx_DAOWalletPanel_statLabel">DAO 지갑 수:</span>
                            <span className="mx_DAOWalletPanel_statValue">{walletSummaries.length}개</span>
                        </div>
                        <div className="mx_DAOWalletPanel_stat">
                            <span className="mx_DAOWalletPanel_statLabel">총 보유 토큰:</span>
                            <span className="mx_DAOWalletPanel_statValue">{formatCurrency(totalBalance)}</span>
                        </div>
                    </div>
                </div>

                {renderWalletList()}
                {renderRestoreSection()}
            </div>
        </div>
    );
};

export default DAOWalletPanel;