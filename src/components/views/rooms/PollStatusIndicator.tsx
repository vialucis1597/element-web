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
                // Skip the poll.responses approach and go directly to manual counting
                console.log("[PollStatusIndicator] Using manual vote counting method");
                
                try {
                    const timeline = room.getLiveTimeline();
                    const events = timeline.getEvents();
                    const pollId = pollStartEvent.getId();
                    
                    // Get poll answers first
                    const pollContent = pollStartEvent.getContent();
                    const pollStart = pollContent["org.matrix.msc3381.poll.start"] || pollContent["m.poll.start"];
                    const answers = pollStart?.answers || [];
                    
                    console.log(`[PollStatusIndicator] Available answers:`, answers);
                    
                    const responseEvents = events.filter(event => {
                        const eventType = event.getType();
                        const isResponseEvent = eventType === "org.matrix.msc3381.poll.response" || eventType === "m.poll.response";
                        if (!isResponseEvent) return false;
                        
                        const content = event.getContent();
                        const relatesTo = content["m.relates_to"];
                        return relatesTo && relatesTo.event_id === pollId;
                    });
                    
                    console.log(`[PollStatusIndicator] Found ${responseEvents.length} response events`);
                    
                    const voteCounts = new Map<string, number>();
                    
                    responseEvents.forEach(responseEvent => {
                        const content = responseEvent.getContent();
                        const response = content["org.matrix.msc3381.poll.response"] || content["m.poll.response"];
                        const answerIds = response?.answers;
                        
                        console.log(`[PollStatusIndicator] Response event content:`, response);
                        
                        if (Array.isArray(answerIds) && answerIds.length > 0) {
                            const answerId = answerIds[0];
                            voteCounts.set(answerId, (voteCounts.get(answerId) || 0) + 1);
                            console.log(`[PollStatusIndicator] Vote for answer ID: ${answerId}`);
                        }
                    });
                    
                    // Show vote counts for each option
                    answers.forEach((answer: any) => {
                        const answerText = answer?.["org.matrix.msc1767.text"] || answer?.["m.text"] || 'Unknown';
                        const voteCount = voteCounts.get(answer.id) || 0;
                        console.log(`[PollStatusIndicator] "${answerText}" (${answer.id}): ${voteCount} votes`);
                    });
                    
                    let maxVotes = 0;
                    let winningOptionId = '';
                    voteCounts.forEach((count, optionId) => {
                        if (count > maxVotes) {
                            maxVotes = count;
                            winningOptionId = optionId;
                        }
                    });
                    
                    if (maxVotes > 0) {
                        const winningAnswer = answers.find((a: any) => a.id === winningOptionId);
                        const winningText = winningAnswer?.["org.matrix.msc1767.text"] || winningAnswer?.["m.text"] || 'Unknown';
                        
                        console.log(`[PollStatusIndicator] Winner: "${winningText}" with ${maxVotes} votes`);
                        
                        setPollStatus({
                            isActive: false,
                            winningOption: winningText,
                            hasVotes: true
                        });
                    } else {
                        console.log(`[PollStatusIndicator] No votes found`);
                        setPollStatus({ isActive: false, hasVotes: false });
                    }
                } catch (error) {
                    console.error("Manual vote counting failed:", error);
                    setPollStatus({ isActive: false, hasVotes: false });
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
                setTimeout(checkPollStatus, 250);
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
                setTimeout(checkPollStatus, 250);
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

    const winnerText = pollStatus.winningOption?.toLowerCase() || '';
    console.log(`[PollStatusIndicator] Determining winner display for: "${pollStatus.winningOption}"`);
    
    const isForWinning = winnerText.includes("for");
    const isAgainstWinning = winnerText.includes("against") || winnerText.includes("abstain");
    
    console.log(`[PollStatusIndicator] isForWinning: ${isForWinning}, isAgainstWinning: ${isAgainstWinning}`);

    if (isForWinning) {
        console.log(`[PollStatusIndicator] Showing FOR winner (✓)`);
        return (
            <div className={classes} title={`투표 완료: ${pollStatus.winningOption}`}>
                <div className="mx_PollStatusIndicator_checkIcon">✓</div>
            </div>
        );
    } else if (isAgainstWinning) {
        console.log(`[PollStatusIndicator] Showing AGAINST/ABSTAIN winner (●)`);
        return (
            <div className={classes} title={`투표 완료: ${pollStatus.winningOption}`}>
                <div className="mx_PollStatusIndicator_abstainIcon">●</div>
            </div>
        );
    }

    // Default case - if we can't determine the winner type, show generic completed status
    console.log(`[PollStatusIndicator] Unknown winner type, showing default (✓)`);
    return (
        <div className={classes} title={`투표 완료: ${pollStatus.winningOption || 'Unknown'}`}>
            <div className="mx_PollStatusIndicator_completedIcon">✓</div>
        </div>
    );
};

export default PollStatusIndicator;
