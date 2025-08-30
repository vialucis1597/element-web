import React, { useState, useEffect, useCallback } from "react";
import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import { MnemonicWallet, type WalletData, type WalletBalance } from "../../../utils/MnemonicWallet";
import { DAOContributionTracker } from "../../../utils/DAOContributionTracker";
import Modal from "../../../Modal";
import InfoDialog from "../dialogs/InfoDialog";

interface Props {
    onClose?: () => void;
}

const DAOWalletPanel: React.FC<Props> = ({ onClose }) => {
    const [walletData, setWalletData] = useState<WalletData | null>(null);
    const [mnemonic, setMnemonic] = useState("");
    const [showMnemonicInput, setShowMnemonicInput] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const wallet = MnemonicWallet.getInstance();

    // 지갑 데이터 업데이트 리스너
    const handleWalletUpdate = useCallback((newWalletData: WalletData) => {
        setWalletData(newWalletData);
    }, []);

    useEffect(() => {
        // 기존 지갑 데이터 로드
        const existingWallet = wallet.loadWalletFromStorage();
        if (existingWallet) {
            setWalletData(existingWallet);
        }

        // 리스너 등록
        wallet.addListener(handleWalletUpdate);

        return () => {
            wallet.removeListener(handleWalletUpdate);
        };
    }, [wallet, handleWalletUpdate]);

    const handleCreateNewWallet = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const newMnemonic = wallet.generateNewMnemonic();
            const newWallet = wallet.createWalletFromMnemonic(newMnemonic);
            setWalletData(newWallet);
            
            // DAO Contribution Tracker 초기화 (지갑 생성 후)
            DAOContributionTracker.getInstance().initialize();
            
            // 포커스 문제 해결을 위한 간단한 알림
            setTimeout(() => {
                const modal = Modal.createDialog(InfoDialog, {
                    title: "지갑 생성 완료",
                    description: (
                        <div>
                            <p><strong>새 지갑이 생성되었습니다!</strong></p>
                            <p>니모닉 문구를 안전하게 보관하세요:</p>
                            <div style={{ 
                                backgroundColor: "#f5f5f5", 
                                padding: "10px", 
                                borderRadius: "4px", 
                                fontFamily: "monospace",
                                wordBreak: "break-all",
                                margin: "10px 0"
                            }}>
                                {newMnemonic}
                            </div>
                            <p><em>이 문구를 분실하면 지갑을 복원할 수 없습니다.</em></p>
                        </div>
                    ),
                    button: "확인",
                    onFinished: () => {
                        // 모달 닫힌 후 포커스 복원
                        setTimeout(() => {
                            const messageComposer = document.querySelector('.mx_SendMessageComposer textarea');
                            if (messageComposer && (messageComposer as HTMLElement).focus) {
                                (messageComposer as HTMLElement).focus();
                            }
                        }, 100);
                    }
                });
            }, 50);
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 생성 실패");
        } finally {
            setIsLoading(false);
        }
    }, [wallet]);

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

            const restoredWallet = wallet.createWalletFromMnemonic(mnemonic.trim());
            setWalletData(restoredWallet);
            
            // DAO Contribution Tracker 초기화 (지갑 복원 후)
            DAOContributionTracker.getInstance().initialize();
            
            setShowMnemonicInput(false);
            setMnemonic("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 복원 실패");
        } finally {
            setIsLoading(false);
        }
    }, [wallet, mnemonic]);

    const handleExportWallet = useCallback(() => {
        try {
            const exportData = wallet.exportWalletData();
            const blob = new Blob([exportData], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `dao-wallet-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : "지갑 내보내기 실패");
        }
    }, [wallet]);

    const formatCurrency = (amount: number): string => {
        return new Intl.NumberFormat().format(amount);
    };

    const renderWalletInfo = () => {
        if (!walletData) return null;

        return (
            <div className="mx_DAOWalletPanel_walletInfo">
                <div className="mx_DAOWalletPanel_address">
                    <h4>지갑 주소</h4>
                    <div className="mx_DAOWalletPanel_addressValue">
                        {walletData.address}
                    </div>
                </div>

                <div className="mx_DAOWalletPanel_totalContributions">
                    <h4>총 기여 수익</h4>
                    <div className="mx_DAOWalletPanel_totalValue">
                        {formatCurrency(walletData.totalContributions)}
                    </div>
                </div>

                <div className="mx_DAOWalletPanel_balances">
                    <h4>DAO별 보유 화폐</h4>
                    {walletData.balances.length === 0 ? (
                        <div className="mx_DAOWalletPanel_emptyBalances">
                            아직 참여한 DAO가 없습니다.<br/>
                            DCA 룸에서 채팅하고 react하여 기여 수익을 받아보세요!
                        </div>
                    ) : (
                        <div className="mx_DAOWalletPanel_balancesList">
                            {walletData.balances.map((balance: WalletBalance) => (
                                <div key={balance.daoId} className="mx_DAOWalletPanel_balanceItem">
                                    <div className="mx_DAOWalletPanel_daoInfo">
                                        <div className="mx_DAOWalletPanel_daoName">{balance.daoName}</div>
                                        <div className="mx_DAOWalletPanel_daoCurrency">{balance.currency}</div>
                                    </div>
                                    <div className="mx_DAOWalletPanel_balanceAmount">
                                        {formatCurrency(balance.amount)}
                                    </div>
                                    <div className="mx_DAOWalletPanel_contributionValue">
                                        기여가치: {formatCurrency(balance.contributionValue)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="mx_DAOWalletPanel_actions">
                    <AccessibleButton
                        kind="primary"
                        onClick={handleExportWallet}
                        className="mx_DAOWalletPanel_exportButton"
                    >
                        지갑 백업
                    </AccessibleButton>
                    <AccessibleButton
                        kind="danger"
                        onClick={() => {
                            // 포커스 복원을 위해 현재 element 저장
                            const currentElement = document.activeElement as HTMLElement;
                            
                            setTimeout(() => {
                                if (confirm("정말로 지갑을 초기화하시겠습니까? 니모닉이 있어야 복원할 수 있습니다.")) {
                                    wallet.clearWallet();
                                    setWalletData(null);
                                }
                                
                                // 포커스 복원 - 채팅 입력창으로 직접 포커스 이동
                                setTimeout(() => {
                                    const messageComposer = document.querySelector('.mx_SendMessageComposer textarea');
                                    if (messageComposer && (messageComposer as HTMLElement).focus) {
                                        (messageComposer as HTMLElement).focus();
                                    } else if (currentElement && currentElement.focus) {
                                        currentElement.focus();
                                    }
                                }, 100);
                            }, 0);
                        }}
                        className="mx_DAOWalletPanel_clearButton"
                    >
                        지갑 초기화
                    </AccessibleButton>
                </div>
            </div>
        );
    };

    const renderWalletSetup = () => {
        return (
            <div className="mx_DAOWalletPanel_setup">
                <h3>DAO 니모닉 지갑</h3>
                <p>모든 서버의 DAO에서 사용할 수 있는 범용 지갑을 설정하세요.</p>

                {error && (
                    <div className="mx_DAOWalletPanel_error">
                        {error}
                    </div>
                )}

                {!showMnemonicInput ? (
                    <div className="mx_DAOWalletPanel_setupActions">
                        <AccessibleButton
                            kind="primary"
                            onClick={handleCreateNewWallet}
                            disabled={isLoading}
                            className="mx_DAOWalletPanel_createButton"
                        >
                            {isLoading ? <Spinner w={16} h={16} /> : "새 지갑 생성"}
                        </AccessibleButton>

                        <AccessibleButton
                            kind="secondary"
                            onClick={() => setShowMnemonicInput(true)}
                            disabled={isLoading}
                            className="mx_DAOWalletPanel_restoreButton"
                        >
                            기존 지갑 복원
                        </AccessibleButton>
                    </div>
                ) : (
                    <div className="mx_DAOWalletPanel_mnemonicInput">
                        <Field
                            label="니모닉 문구 (12단어)"
                            placeholder="word1 word2 word3 ..."
                            value={mnemonic}
                            onChange={(e) => setMnemonic(e.target.value)}
                            type="text"
                        />
                        
                        <div className="mx_DAOWalletPanel_mnemonicActions">
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
    };

    return (
        <div className="mx_DAOWalletPanel">
            <div className="mx_DAOWalletPanel_header">
                <h2>DAO 지갑</h2>
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
                {walletData ? renderWalletInfo() : renderWalletSetup()}
            </div>
        </div>
    );
};

export default DAOWalletPanel;
