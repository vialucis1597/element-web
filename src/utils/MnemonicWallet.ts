import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "bip39";
// @ts-ignore
const HDKey = require("hdkey");
import { keccak256 } from "js-sha3";

export interface WalletBalance {
    daoId: string;
    daoName: string;
    currency: string;
    amount: number;
    contributionValue: number; // 각 DAO의 DCA 룸에서 설정된 기여가치
}

export interface WalletData {
    address: string;
    privateKey: string;
    balances: WalletBalance[];
    totalContributions: number;
}

export class MnemonicWallet {
    private static instance: MnemonicWallet;
    private walletData: WalletData | null = null;
    private listeners: ((wallet: WalletData) => void)[] = [];

    static getInstance(): MnemonicWallet {
        if (!MnemonicWallet.instance) {
            MnemonicWallet.instance = new MnemonicWallet();
        }
        return MnemonicWallet.instance;
    }

    // 새로운 니모닉 생성
    generateNewMnemonic(): string {
        return generateMnemonic(128); // 12 words
    }

    // 니모닉으로부터 지갑 생성/복원
    createWalletFromMnemonic(mnemonic: string): WalletData {
        if (!validateMnemonic(mnemonic)) {
            throw new Error("Invalid mnemonic phrase");
        }

        // 니모닉에서 시드 생성
        const seed = mnemonicToSeedSync(mnemonic);
        
        // HD 지갑 생성 (BIP44 경로: m/44'/60'/0'/0/0)
        const hdkey = HDKey.fromMasterSeed(seed);
        const wallet = hdkey.derive("m/44'/60'/0'/0/0");
        
        // 주소 생성 (Ethereum 스타일)
        const publicKey = wallet.publicKey;
        const address = "0x" + keccak256(publicKey.slice(1)).slice(-40);
        
        this.walletData = {
            address,
            privateKey: wallet.privateKey!.toString('hex'),
            balances: [],
            totalContributions: 0
        };

        // 로컬 스토리지에 저장 (암호화 권장)
        this.saveWalletToStorage();
        this.notifyListeners();

        return this.walletData;
    }

    // 지갑 데이터 로드
    loadWalletFromStorage(): WalletData | null {
        try {
            const stored = localStorage.getItem('dao_mnemonic_wallet');
            if (stored) {
                this.walletData = JSON.parse(stored);
                return this.walletData;
            }
        } catch (error) {
            console.error("Failed to load wallet from storage:", error);
        }
        return null;
    }

    // 지갑 데이터 저장
    private saveWalletToStorage(): void {
        if (this.walletData) {
            localStorage.setItem('dao_mnemonic_wallet', JSON.stringify(this.walletData));
        }
    }

    // 특정 DAO의 잔액 조회
    getDAOBalance(daoId: string): WalletBalance | null {
        if (!this.walletData) return null;
        
        return this.walletData.balances.find(balance => balance.daoId === daoId) || null;
    }

    // DAO 화폐 추가/업데이트
    addOrUpdateDAOCurrency(daoId: string, daoName: string, currency: string, contributionValue: number): void {
        if (!this.walletData) return;

        const existingIndex = this.walletData.balances.findIndex(balance => balance.daoId === daoId);
        
        if (existingIndex >= 0) {
            // 기존 DAO 업데이트
            this.walletData.balances[existingIndex] = {
                ...this.walletData.balances[existingIndex],
                daoName,
                currency,
                contributionValue
            };
        } else {
            // 새로운 DAO 추가
            this.walletData.balances.push({
                daoId,
                daoName,
                currency,
                amount: 0,
                contributionValue
            });
        }

        this.saveWalletToStorage();
        this.notifyListeners();
    }

    // 기여가치 지급 (DCA 룸에서 채팅+react 시)
    awardContribution(daoId: string, multiplier: number = 1): boolean {
        if (!this.walletData) return false;

        const daoBalance = this.walletData.balances.find(balance => balance.daoId === daoId);
        if (!daoBalance) return false;

        // 기여가치만큼 화폐 지급
        const awardAmount = daoBalance.contributionValue * multiplier;
        daoBalance.amount += awardAmount;
        this.walletData.totalContributions += awardAmount;

        this.saveWalletToStorage();
        this.notifyListeners();

        console.log(`Awarded ${awardAmount} ${daoBalance.currency} to ${daoBalance.daoName}`);
        return true;
    }

    // 지갑 데이터 조회
    getWalletData(): WalletData | null {
        return this.walletData;
    }

    // 지갑 변경 이벤트 리스너 추가
    addListener(callback: (wallet: WalletData) => void): void {
        this.listeners.push(callback);
    }

    // 지갑 변경 이벤트 리스너 제거
    removeListener(callback: (wallet: WalletData) => void): void {
        this.listeners = this.listeners.filter(listener => listener !== callback);
    }

    // 리스너들에게 변경사항 알림
    private notifyListeners(): void {
        if (this.walletData) {
            this.listeners.forEach(listener => listener(this.walletData!));
        }
    }

    // 지갑 초기화 (로그아웃 시)
    clearWallet(): void {
        this.walletData = null;
        localStorage.removeItem('dao_mnemonic_wallet');
        this.notifyListeners();
    }

    // 니모닉 문구 검증
    validateMnemonicPhrase(mnemonic: string): boolean {
        return validateMnemonic(mnemonic);
    }

    // 지갑 백업 데이터 생성
    exportWalletData(): string {
        if (!this.walletData) throw new Error("No wallet data to export");
        
        return JSON.stringify({
            address: this.walletData.address,
            balances: this.walletData.balances,
            totalContributions: this.walletData.totalContributions,
            exportedAt: new Date().toISOString()
        }, null, 2);
    }
}

export default MnemonicWallet;
