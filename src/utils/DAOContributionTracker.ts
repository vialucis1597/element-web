import { MatrixEvent, EventType, MsgType, RelationType, Room } from "matrix-js-sdk/src/matrix";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { DAOMnemonicWallet } from "./DAOMnemonicWallet";
import SpaceStore from "../stores/spaces/SpaceStore";

export interface ContributionEvent {
    userId: string;
    daoId: string;
    daoName: string;
    roomId: string;
    eventType: 'chat' | 'react';
    timestamp: number;
    contributionValue: number;
}

export class DAOContributionTracker {
    private static instance: DAOContributionTracker;
    private wallet = DAOMnemonicWallet.getInstance();
    private recentContributions: Map<string, number> = new Map(); // userId+daoId -> timestamp
    private readonly CONTRIBUTION_COOLDOWN = 0; // 쿨다운 없음
    private isInitialized = false;

    static getInstance(): DAOContributionTracker {
        if (!DAOContributionTracker.instance) {
            DAOContributionTracker.instance = new DAOContributionTracker();
        }
        return DAOContributionTracker.instance;
    }

    // DCA 룸인지 확인 (DCA 스페이스 안의 모든 룸)
    private isDCARoom(roomId: string): boolean {
        const client = MatrixClientPeg.safeGet();
        const room = client.getRoom(roomId);
        
        console.log("🔍 Checking if room is DCA:", {
            roomId,
            roomName: room?.name,
            isRoom: !!room
        });
        
        if (!room) {
            console.log("❌ Room not found");
            return false;
        }

        // DCA 스페이스 안의 룸인지 확인
        const spaceEvents = room.currentState.getStateEvents(EventType.SpaceParent);
        console.log("🔍 Checking parent spaces:", spaceEvents.length);
        
        for (const event of spaceEvents) {
            const parentRoomId = event.getStateKey();
            if (!parentRoomId) continue;

            const parentRoom = client.getRoom(parentRoomId);
            console.log("🔍 Parent room:", {
                parentRoomId,
                parentName: parentRoom?.name,
                isSpace: parentRoom?.isSpaceRoom()
            });
            
            // 부모가 DCA 스페이스인지 확인
            if (parentRoom?.isSpaceRoom() && parentRoom.name === "DCA") {
                console.log("✅ Found DCA room in DCA space:", room.name);
                return true;
            }
        }

        console.log("❌ Not in DCA space");
        return false;
    }

    // Ledger 룸 찾기
    private findLedgerRoom(daoSpaceId: string): Room | null {
        const client = MatrixClientPeg.safeGet();
        const daoSpace = client.getRoom(daoSpaceId);
        if (!daoSpace) return null;

        // DAO 스페이스의 하위 룸들 중에서 ledger 룸 찾기
        const children = SpaceStore.instance.getChildren(daoSpaceId);
        for (const child of children) {
            const room = client.getRoom(child.roomId);
            if (room && !room.isSpaceRoom() && room.name === "ledger") {
                return room;
            }
        }
        return null;
    }

    // DAO 정보 가져오기 (단순화)
    private getDAOInfo(dcaRoomId: string): { daoId: string; daoName: string; contributionValue: number; ledgerRoom: Room | null } | null {
        const client = MatrixClientPeg.safeGet();
        const dcaRoom = client.getRoom(dcaRoomId);
        
        if (!dcaRoom) return null;

        // DCA 룸의 부모 DCA 스페이스 찾기
        const spaceEvents = dcaRoom.currentState.getStateEvents(EventType.SpaceParent);
        
        for (const event of spaceEvents) {
            const dcaSpaceId = event.getStateKey();
            if (!dcaSpaceId) continue;

            const dcaSpace = client.getRoom(dcaSpaceId);
            if (!dcaSpace?.isSpaceRoom() || dcaSpace.name !== "DCA") continue;

            // DCA 스페이스의 부모 DAO 스페이스 찾기
            const daoSpaceEvents = dcaSpace.currentState.getStateEvents(EventType.SpaceParent);
            
            for (const daoEvent of daoSpaceEvents) {
                const daoSpaceId = daoEvent.getStateKey();
                if (!daoSpaceId) continue;

                const daoSpace = client.getRoom(daoSpaceId);
                if (!daoSpace?.isSpaceRoom()) continue;

                // DCA 룸에서 직접 기여가치 추출 (토픽에서)
                const dcaRoomTopic = dcaRoom.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic || "";
                console.log("🔍 DCA Room Topic:", dcaRoomTopic);
                const contributionMatch = dcaRoomTopic.match(/Contribution Value:\s*(\d+)(?:\w*)/i);
                const contributionValue = contributionMatch ? parseInt(contributionMatch[1]) : 10;
                console.log("💰 Extracted contribution value from DCA room:", contributionValue);

                // Ledger 룸 찾기
                const ledgerRoom = this.findLedgerRoom(daoSpaceId);
                console.log("📚 Ledger room found:", ledgerRoom?.name);

                return {
                    daoId: daoSpaceId,
                    daoName: daoSpace.name || "Unknown DAO",
                    contributionValue,
                    ledgerRoom
                };
            }
        }

        return null;
    }

    // 쿨다운 확인
    private isOnCooldown(userId: string, daoId: string): boolean {
        const key = `${userId}:${daoId}`;
        const lastContribution = this.recentContributions.get(key) || 0;
        return Date.now() - lastContribution < this.CONTRIBUTION_COOLDOWN;
    }

    // 쿨다운 설정
    private setCooldown(userId: string, daoId: string): void {
        const key = `${userId}:${daoId}`;
        this.recentContributions.set(key, Date.now());
    }

    // 원장 룸에 거래 기록
    private async recordTransaction(
        ledgerRoom: Room,
        dcaRoomName: string,
        daoName: string,
        recipientWalletAddress: string,
        amount: number,
        verifierName: string,
        verifierUserId: string
    ): Promise<void> {
        try {
            const client = MatrixClientPeg.safeGet();
            
            // 기본 트랜잭션 데이터 생성
            const basicTxData = {
                type: `PoC: ${dcaRoomName}`,
                from: `${daoName} minting`,
                to: recipientWalletAddress,
                amount: amount,
                verifier: verifierName,
                verifierUserId: verifierUserId,
                timestamp: Date.now(),
            };

            // 트랜잭션 해시 생성
            const txHash = this.generateTransactionHash(recipientWalletAddress, amount, basicTxData.timestamp);
            
            // 서명할 데이터 문자열 생성
            const dataToSign = `${basicTxData.type}|${basicTxData.from}|${basicTxData.to}|${basicTxData.amount}|${basicTxData.timestamp}|${txHash}`;
            
            // 검증자의 DAO 지갑으로 디지털 서명 생성  
            let digitalSignature = null;
            // 우선 원장 기록에서 DAO ID 추출 시도
            const ledgerSpaceEvents = ledgerRoom.currentState.getStateEvents(EventType.SpaceParent);
            let parentDaoId = null;
            
            for (const event of ledgerSpaceEvents) {
                const parentId = event.getStateKey();
                if (parentId) {
                    const parentRoom = MatrixClientPeg.safeGet().getRoom(parentId);
                    if (parentRoom?.isSpaceRoom() && parentRoom.name !== "DCA") {
                        parentDaoId = parentId;
                        break;
                    }
                }
            }
            
            if (parentDaoId && this.wallet.hasDAOWallet(parentDaoId)) {
                digitalSignature = this.wallet.signData(parentDaoId, dataToSign);
                console.log("🔐 Digital signature generated with DAO wallet:", digitalSignature?.substring(0, 16) + "...");
            } else {
                console.warn("⚠️ No DAO wallet available for digital signature, proceeding without signature");
                digitalSignature = "unsigned_transaction";
            }

            const transactionData = {
                ...basicTxData,
                txHash,
                signature: digitalSignature,
                dataToSign // 검증용으로 포함
            };

            console.log("📝 Recording transaction to ledger:", transactionData);

            await client.sendEvent(ledgerRoom.roomId, EventType.RoomMessage, {
                msgtype: MsgType.Text,
                body: `🏦 TRANSACTION RECORD 🏦\n${JSON.stringify(transactionData, null, 2)}`,
                format: "org.matrix.custom.html",
                formatted_body: `
                    <h3>🏦 BLOCKCHAIN TRANSACTION RECORD 🏦</h3>
                    <table border="1" style="border-collapse: collapse; width: 100%;">
                        <tr><td><b>Type</b></td><td>${transactionData.type}</td></tr>
                        <tr><td><b>From</b></td><td>${transactionData.from}</td></tr>
                        <tr><td><b>To</b></td><td>${transactionData.to}</td></tr>
                        <tr><td><b>Amount</b></td><td>${transactionData.amount}</td></tr>
                        <tr><td><b>Verifier</b></td><td>${transactionData.verifier}</td></tr>
                        <tr><td><b>Verifier ID</b></td><td><code>${transactionData.verifierUserId}</code></td></tr>
                        <tr><td><b>Timestamp</b></td><td>${new Date(transactionData.timestamp).toISOString()}</td></tr>
                        <tr><td><b>TX Hash</b></td><td><code>${transactionData.txHash}</code></td></tr>
                        <tr><td><b>Digital Signature</b></td><td><code>${transactionData.signature ? transactionData.signature.substring(0, 32) + "..." : "N/A"}</code></td></tr>
                        <tr><td><b>Signature Status</b></td><td>${transactionData.signature ? "✅ Signed" : "❌ Unsigned"}</td></tr>
                    </table>
                `,
                transaction_data: transactionData // 원장 처리용 메타데이터
            });

            console.log("✅ Transaction recorded to ledger successfully");
        } catch (error) {
            console.error("💥 Failed to record transaction to ledger:", error);
            throw error; // 에러를 다시 던져서 상위에서 처리하도록 함
        }
    }

    // 거래 해시 생성 (간단한 구현)
    private generateTransactionHash(to: string, amount: number, timestamp: number): string {
        const data = `${to}-${amount}-${timestamp}`;
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 32bit integer
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    // 채팅 이벤트 처리 (비활성화 - Verification 버튼만 사용)
    handleChatEvent(event: MatrixEvent): void {
        // 채팅으로는 기여증명 발행하지 않음
        console.log("Chat event ignored - only Verification button awards contributions");
        return;
    }

    // Verification 이벤트 처리 (일반 react와 구분)
    async handleVerificationEvent(event: MatrixEvent): Promise<void> {
        try {
            console.log("👍 React event received:", event.getType(), event.getContent());
            
            // Reaction 이벤트인지 확인 (annotation relation)
            const content = event.getContent();
            if (content?.["m.relates_to"]?.rel_type !== RelationType.Annotation) {
                console.log("Not an annotation reaction, skipping");
                return;
            }

            // Verification 이벤트인지 확인 (일반 react는 무시)
            if (!content.verification || content.verification !== true) {
                console.log("Not a verification event, skipping contribution award");
                return;
            }
            
            console.log("✅ Verification event detected, processing contribution award");

            const roomId = event.getRoomId();
            if (!roomId || !this.isDCARoom(roomId)) {
                console.log("Not a DCA room, skipping");
                return;
            }

            // 리액트를 받은 원본 메시지 찾기
            const relatesTo = content["m.relates_to"];
            const originalEventId = relatesTo?.event_id;
            
            if (!originalEventId) {
                console.log("No original event ID found, skipping");
                return;
            }

            const client = MatrixClientPeg.safeGet();
            const room = client.getRoom(roomId);
            const originalEvent = room?.findEventById(originalEventId);
            
            if (!originalEvent) {
                console.log("Original event not found, skipping");
                return;
            }

            // 검증자 본인에게 토큰 지급 (검증 행위에 대한 보상)
            const verifierUserId = event.getSender();
            console.log("💰 Rewarding verifier:", verifierUserId);

            const daoInfo = this.getDAOInfo(roomId);
            if (!daoInfo) {
                console.log("No DAO info found, skipping");
                return;
            }

            // 쿨다운 확인 (검증자 기준)
            if (this.isOnCooldown(verifierUserId, daoInfo.daoId)) {
                console.log("Contribution on cooldown for verifier", verifierUserId);
                return;
            }

            console.log("💎 Processing verification contribution for DAO:", daoInfo.daoName);
            
            const dcaRoomName = room?.name || "Unknown Room";
            
            // 검증자 지갑에 기여가치 지급 (검증→원장→지갑 순서)
            await this.awardContribution(verifierUserId, daoInfo, 'react', dcaRoomName, verifierUserId);
        } catch (error) {
            console.error("💥 Error handling react event:", error);
        }
    }

    // 기여가치 지급
    private async awardContribution(
        userId: string, 
        daoInfo: { daoId: string; daoName: string; contributionValue: number; ledgerRoom: Room | null }, 
        eventType: 'chat' | 'react',
        dcaRoomName: string,
        verifierUserId: string
    ): Promise<void> {
        console.log("💰 Awarding contribution:", {
            userId,
            daoName: daoInfo.daoName,
            contributionValue: daoInfo.contributionValue,
            eventType,
            dcaRoomName,
            verifierUserId
        });

        // DAO 지갑 존재 확인 및 생성
        if (!this.wallet.hasDAOWallet(daoInfo.daoId)) {
            console.log("⚠️ DAO wallet not found, creating new wallet for", daoInfo.daoName);
            this.wallet.createDAOWallet(daoInfo.daoId, daoInfo.daoName, "B", daoInfo.contributionValue);
        }

        try {
            // 1단계: DAO 지갑 주소 가져오기
            const daoWallet = this.wallet.getDAOWallet(daoInfo.daoId);
            if (!daoWallet) {
                console.error("❌ Failed to get DAO wallet");
                return;
            }
            const recipientWalletAddress = daoWallet.address;

            // 2단계: 검증자 이름 가져오기
            const client = MatrixClientPeg.safeGet();
            const verifierUser = client.getUser(verifierUserId);
            const verifierName = verifierUser?.displayName || verifierUserId;

            // 3단계: 원장 룸에 거래 기록 (있는 경우) - 실패해도 계속 진행
            if (daoInfo.ledgerRoom) {
                try {
                    await this.recordTransaction(
                        daoInfo.ledgerRoom,
                        dcaRoomName,
                        daoInfo.daoName,
                        recipientWalletAddress,
                        daoInfo.contributionValue,
                        verifierName,
                        verifierUserId
                    );
                    console.log("✅ Ledger transaction recorded successfully");
                } catch (error) {
                    console.error("⚠️ Ledger recording failed, but continuing with wallet update:", error);
                }
            } else {
                console.log("⚠️ No ledger room found, proceeding without ledger record");
            }

            // 4단계: 원장 기록 결과와 관계없이 지갑 업데이트 진행
            try {
                // DAO 지갑 화폐 정보 업데이트
                this.wallet.updateDAOCurrency(
                    daoInfo.daoId,
                    "B",
                    daoInfo.contributionValue
                );

                // 기여가치 지급 (설정된 값 그대로)
                const awarded = this.wallet.awardContribution(daoInfo.daoId, 1);

                if (awarded) {
                    this.setCooldown(userId, daoInfo.daoId);

                    // 알림 표시
                    this.showContributionNotification(
                        daoInfo.daoName,
                        daoInfo.contributionValue,
                        eventType
                    );

                    console.log("✅ Complete flow: Verification → Wallet update successful");
                } else {
                    console.log("❌ Failed to update wallet");
                }
            } catch (walletError) {
                console.error("💥 Error updating wallet:", walletError);
            }
        } catch (error) {
            console.error("💥 Error in contribution award flow:", error);
        }
    }

    // 기여 알림 표시
    private showContributionNotification(daoName: string, amount: number, eventType: 'chat' | 'react'): void {
        // 간단한 토스트 알림 (실제로는 더 정교한 알림 시스템 사용 권장)
        const message = `🎉 ${daoName}에서 ${amount} 토큰을 받았습니다! (${eventType === 'chat' ? '채팅' : '반응'})`;
        
        // 브라우저 알림 또는 토스트 메시지 표시
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('DAO 기여 수익', {
                body: message,
                icon: '/favicon.ico'
            });
        } else {
            // 콘솔에 로그 (실제로는 UI 토스트 메시지로 교체)
            console.log(message);
        }
    }

    // 이벤트 리스너 등록 (지연 초기화)
    initialize(): void {
        if (this.isInitialized) {
            console.log("⚠️ DAO Contribution Tracker already initialized, skipping...");
            return;
        }

        const client = MatrixClientPeg.safeGet();
        console.log("🚀 Initializing DAO Contribution Tracker...");

        // 매우 제한적인 타임라인 이벤트 리스너 (DCA 룸 + 기여 관련 이벤트만)
        client.on("Room.timeline" as any, (event: MatrixEvent, room: Room | undefined) => {
            try {
                const eventType = event.getType();
                const content = event.getContent();
                
                // Reaction 이벤트만 처리
                if (eventType !== EventType.Reaction) {
                    return;
                }
                
                // 디버깅: Reaction 이벤트 로깅
                console.log("🔍 Reaction event:", {
                    type: eventType,
                    content: content,
                    verification: content?.verification,
                    relatesTo: content?.["m.relates_to"],
                    sender: event.getSender()
                });
                
                // Verification 이벤트 확인
                const isVerification = content?.["m.relates_to"]?.rel_type === RelationType.Annotation && content?.verification === true;
                
                if (!isVerification) {
                    console.log("❌ Not a verification event, skipping");
                    return;
                }
                
                console.log("✅ Verification event found!");

                // DCA 룸이 아니면 바로 종료
                const roomId = event.getRoomId();
                console.log("🔍 Checking if DCA room:", roomId);
                if (!roomId || !this.isDCARoom(roomId)) {
                    console.log("❌ Not a DCA room, skipping");
                    return;
                }
                console.log("✅ DCA room confirmed!");
                
                console.log("📧 DCA Verification Timeline event:", {
                    type: eventType,
                    sender: event.getSender(),
                    room: room?.name,
                    roomId: roomId,
                    originalEventId: content?.["m.relates_to"]?.event_id
                });
                
                // Verification 이벤트 처리
                console.log("✅ Processing DCA Verification");
                this.handleVerificationEvent(event).catch(error => {
                    console.error("💥 Error in verification event handling:", error);
                });
            } catch (error) {
                console.error("💥 Error processing timeline event:", error);
            }
        });

        this.isInitialized = true;
        console.log("✅ DAO Contribution Tracker initialized successfully");
    }

    // 정리
    cleanup(): void {
        // 이벤트 리스너 제거는 Matrix 클라이언트가 처리
        this.recentContributions.clear();
    }
}

export default DAOContributionTracker;
