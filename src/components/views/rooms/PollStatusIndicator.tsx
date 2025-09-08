/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useEffect, useState } from "react";
import { type Room, type MatrixEvent, type Poll, PollEvent } from "matrix-js-sdk/src/matrix";
import { M_POLL_START, M_POLL_END } from "matrix-js-sdk/src/matrix";
import { type PollStartEvent } from "matrix-js-sdk/src/extensible_events_v1/PollStartEvent";
import classNames from "classnames";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { findTopAnswer } from "../messages/MPollBody";
import { createVoteRelations } from "../messages/MPollBody";

interface Props {
    room: Room;
    className?: string;
}

interface PollStatus {
    isActive: boolean;
    winningOption?: string;
    hasVotes: boolean;
}

const PollStatusIndicator: React.FC<Props> = ({ room, className }) => {
    const [pollStatus, setPollStatus] = useState<PollStatus | null>(null);
    
    useEffect(() => {
        const checkPollStatus = () => {
            // Only check for proposal rooms
            if (!room.name?.startsWith("Proposal #")) {
                setPollStatus(null);
                return;
            }

            const client = MatrixClientPeg.safeGet();
            const timeline = room.getLiveTimeline();
            const events = timeline.getEvents();
            
            // Find the most recent poll start event
            let pollStartEvent: MatrixEvent | null = null;
            for (let i = events.length - 1; i >= 0; i--) {
                const event = events[i];
                if (event.getType() === M_POLL_START.name || event.getType() === M_POLL_START.altName) {
                    pollStartEvent = event;
                    break;
                }
            }

            if (!pollStartEvent) {
                // No poll found yet, but this is a proposal room, so show active status
                // This handles the case where poll hasn't loaded yet after room creation
                setPollStatus({ isActive: true, hasVotes: false });
                return;
            }

            const poll = room.polls.get(pollStartEvent.getId()!);
            if (!poll) {
                // Poll event exists but poll object not ready yet, assume active
                setPollStatus({ isActive: true, hasVotes: false });
                return;
            }

            const isActive = !poll.isEnded;
            
            if (isActive) {
                setPollStatus({ isActive: true, hasVotes: false });
            } else {
                // Poll is ended, determine the winner
                try {
                    // Try using the poll object's responses directly
                    const responses = poll.responses;
                    let hasVotes = false;
                    let winningOption = '';
                    let maxVotes = 0;

                    responses.forEach((responseEvents, optionId) => {
                        const voteCount = responseEvents.length;
                        if (voteCount > 0) {
                            hasVotes = true;
                        }
                        if (voteCount > maxVotes) {
                            maxVotes = voteCount;
                            // Get option text from poll start event
                            const pollContent = pollStartEvent.getContent();
                            const pollStart = pollContent["org.matrix.msc3381.poll.start"] || pollContent["m.poll.start"];
                            const answers = pollStart?.answers || [];
                            const answer = answers.find((a: any) => a.id === optionId);
                            winningOption = answer?.["org.matrix.msc1767.text"] || answer?.["m.text"] || '';
                        }
                    });

                    console.log(`[PollStatusIndicator] Poll ended - hasVotes: ${hasVotes}, winner: "${winningOption}"`);
                    
                    setPollStatus({
                        isActive: false,
                        winningOption: hasVotes ? winningOption : undefined,
                        hasVotes
                    });
                } catch (error) {
                    console.error("Error determining poll winner:", error);
                    // Fallback: if there's an error, assume there were votes and For won (temporary)
                    console.log("[PollStatusIndicator] Fallback - assuming For won");
                    setPollStatus({ 
                        isActive: false, 
                        winningOption: "For", 
                        hasVotes: true 
                    });
                }
            }
        };

        // Initial check with a slight delay to ensure room is fully loaded
        checkPollStatus();
        const initialTimeout = setTimeout(checkPollStatus, 100);

        // Listen for poll events
        const onPollUpdate = (event: MatrixEvent) => {
            if (event.getRoomId() === room.roomId) {
                // Add small delay to ensure poll state is updated
                setTimeout(checkPollStatus, 50);
            }
        };

        const onRoomTimeline = (event: MatrixEvent, eventRoom?: Room) => {
            if (eventRoom?.roomId === room.roomId && 
                (event.getType() === M_POLL_START.name || 
                 event.getType() === M_POLL_START.altName ||
                 event.getType() === M_POLL_END.name ||
                 event.getType() === M_POLL_END.altName ||
                 event.getType().includes("poll"))) {
                // Add delay to ensure event is processed
                setTimeout(checkPollStatus, 100);
            }
        };

        // Listen for poll state changes
        room.on(PollEvent.New, onPollUpdate);
        room.on(PollEvent.End, onPollUpdate);
        room.on(PollEvent.Update, onPollUpdate);
        MatrixClientPeg.safeGet().on("Room.timeline", onRoomTimeline);

        // Also listen for room state changes to catch poll updates
        const onRoomStateEvent = (event: MatrixEvent) => {
            if (event.getRoomId() === room.roomId) {
                setTimeout(checkPollStatus, 50);
            }
        };
        room.on("Room.timeline", onRoomStateEvent);

        return () => {
            clearTimeout(initialTimeout);
            room.off(PollEvent.New, onPollUpdate);
            room.off(PollEvent.End, onPollUpdate);
            room.off(PollEvent.Update, onPollUpdate);
            room.off("Room.timeline", onRoomStateEvent);
            MatrixClientPeg.safeGet().off("Room.timeline", onRoomTimeline);
        };
    }, [room]);

    if (!pollStatus) {
        return null;
    }

    const classes = classNames("mx_PollStatusIndicator", className, {
        "mx_PollStatusIndicator_active": pollStatus.isActive,
        "mx_PollStatusIndicator_ended": !pollStatus.isActive,
    });

    if (pollStatus.isActive) {
        return (
            <div className={classes} title="투표 진행 중">
                <div className="mx_PollStatusIndicator_activeIcon">⏳</div>
            </div>
        );
    }

    // Poll ended - show result
    if (!pollStatus.hasVotes) {
        return (
            <div className={classes} title="투표 완료 (투표 없음)">
                <div className="mx_PollStatusIndicator_noVotes">—</div>
            </div>
        );
    }

    const isForWinning = pollStatus.winningOption?.toLowerCase().includes("for") || false;
    const isAgainstWinning = pollStatus.winningOption?.toLowerCase().includes("against") || 
                            pollStatus.winningOption?.toLowerCase().includes("abstain") || false;

    if (isForWinning) {
        return (
            <div className={classes} title={`투표 완료: ${pollStatus.winningOption}`}>
                <div className="mx_PollStatusIndicator_checkIcon">✓</div>
            </div>
        );
    } else if (isAgainstWinning) {
        return (
            <div className={classes} title={`투표 완료: ${pollStatus.winningOption}`}>
                <div className="mx_PollStatusIndicator_abstainIcon">●</div>
            </div>
        );
    }

    // Default case - show generic completed status
    return (
        <div className={classes} title={`투표 완료: ${pollStatus.winningOption}`}>
            <div className="mx_PollStatusIndicator_completedIcon">✓</div>
        </div>
    );
};

export default PollStatusIndicator;
