// Context lives on the stack. Native stat calculation supplies Gen I ratios and
// the 1..999 clamp; only the affected stat's badge/status modifiers are reapplied.
// The caller puts these helpers in their own ROMX section to protect Battle Core.
// These base strings also validate version 2 projects. Version 3 identity fixes
// are applied by moveBehaviorRuntime; preserve the old output for migration.
export const moveStatHelpers = `
EditorMBStatsCurrentMove:
	ldh a, [hWhoseTurn]
	and a
	ld a, [wPlayerMoveNum]
	ret z
	ld a, [wEnemyMoveNum]
	ret

; c = stat index, result a = change code. bc/de are preserved.
EditorMBStatsCode:
	push bc
	push de
	ld e, c
	ld a, c
	srl a
	add 13
	ld c, a
	call EditorMBStatsCurrentMove
	call EditorMBStatsRead
	bit 0, e
	jr z, .low
	swap a
.low
	and $f
	pop de
	pop bc
	ret

EditorMBTryStatChanges::
	push bc
	push de
	push hl
	call EditorMBStatsCurrentMove
	ld c, 12
	call EditorMBStatsRead
	and a
	jp z, .unmanaged
	ld e, a
	ld a, [wCalculateWhoseStats]
	push af
	ldh a, [hWhoseTurn]
	ld d, a
	ld a, e
	cp 2
	ld a, d
	jr nz, .recipient
	xor 1
.recipient
	ld [wCalculateWhoseStats], a
	xor a
	ld [wMoveMissed], a
	ld a, e
	cp 2
	call z, EditorMBStatsHitTest
	ld a, [wMoveMissed]
	and a
	jp nz, .missed
	ld bc, 0
.change
	srl b
	push bc
	call EditorMBStatsCode
	and a
	call nz, EditorMBStatsChange
	pop bc
	jr nc, .next
	set 7, b
.next
	inc c
	ld a, c
	cp 6
	jr nz, .change
	srl b
	srl b
	ld a, b
	and a
	jr z, .capped
	push bc
	farcall PlayCurrentMoveAnimation
	pop bc
	ld c, 0
.message
	srl b
	push bc
	call c, EditorMBStatsMessage
	pop bc
	inc c
	ld a, c
	cp 6
	jr nz, .message
	jr .done
.capped
	ld a, 1
	ld [wMoveMissed], a
	ld hl, EditorMBStatsNothingText
	call PrintText
	jr .done
.missed
	farcall ConditionalPrintButItFailed
.done
	pop af
	ld [wCalculateWhoseStats], a
	pop hl
	pop de
	pop bc
	scf
	ret
.unmanaged
	pop hl
	pop de
	pop bc
	and a
	ret

; Opponent changes share one Substitute/Mist/accuracy check, rather than rolling
; separately for every stat. Self changes do not need an accuracy roll.
EditorMBStatsHitTest:
	farcall CheckTargetSubstitute
	jr nz, .miss
	ld c, 0
.mistLoop
	call EditorMBStatsCode
	cp 3
	jr nc, .checkMist
	inc c
	ld a, c
	cp 6
	jr nz, .mistLoop
	jr .accuracy
.checkMist
	ld hl, wEnemyBattleStatus2
	ldh a, [hWhoseTurn]
	and a
	jr z, .mist
	ld hl, wPlayerBattleStatus2
.mist
	bit PROTECTED_BY_MIST, [hl]
	jr nz, .miss
.accuracy
; Mist is checked for the whole group above. The native routine still handles
; evasion, X Accuracy and Fly/Dig, without interpreting an individual stat effect.
	ld hl, wPlayerMoveEffect
	ldh a, [hWhoseTurn]
	and a
	jr z, .effect
	ld hl, wEnemyMoveEffect
.effect
	ld a, [hl]
	push af
	push hl
	ld [hl], NO_ADDITIONAL_EFFECT
	farcall MoveHitTest
	pop hl
	pop af
	ld [hl], a
	ret
.miss
	ld a, 1
	ld [wMoveMissed], a
	ret

; a = change code, c = stat. Carry means a stage changed.
EditorMBStatsChange:
	ld b, a
	ld hl, wPlayerMonStatMods
	ld a, [wCalculateWhoseStats]
	and a
	jr z, .stats
	ld hl, wEnemyMonStatMods
.stats
	ld e, c
	ld d, 0
	add hl, de
	ld e, [hl]
	ld a, b
	cp 3
	jr c, .raise
	sub 2
	ld b, a
	ld a, e
	sub b
	jr z, .minimum
	jr c, .minimum
	jr .clamp
.minimum
	ld a, 1
	jr .clamp
.raise
	add e
	cp 14
	jr c, .clamp
	ld a, 13
.clamp
	cp e
	ret z
	ld [hl], a
	ld a, c
	cp 4
	call c, EditorMBStatsRecalculate
	scf
	ret

EditorMBStatsRecalculate:
	call EditorMBStatsEncodeIndex
	farcall EditorMBStatsRecalculateNative
	ret

; Bankswitch clobbers argument registers. Encode the stat index alongside the
; recipient in existing calculation scratch, then decode inside the native bank.
EditorMBStatsEncodeIndex:
	ld a, c
	add a
	ld d, a
	ld a, [wCalculateWhoseStats]
	or d
	ld [wCalculateWhoseStats], a
	ret

EditorMBStatsMessage:
	call EditorMBStatsCode
	ld d, a
	ldh a, [hWhoseTurn]
	push af
	ld a, [wCalculateWhoseStats]
	ld e, a
	ld a, d
	cp 3
	jr c, .speaker
	ld a, e
	xor 1
	ld e, a
.speaker
	ld a, e
	ldh [hWhoseTurn], a
	push de
	call EditorMBStatsEncodeIndex
	farcall EditorMBStatsNameNative
	pop de
	ld a, d
	ld hl, EditorMBStatsRoseText
	cp 1
	jr z, .print
	ld hl, EditorMBStatsGreatlyRoseText
	cp 2
	jr z, .print
	ld hl, EditorMBStatsFellText
	cp 3
	jr z, .print
	ld hl, EditorMBStatsGreatlyFellText
.print
	call PrintText
	pop af
	ldh [hWhoseTurn], a
	ret

EditorMBStatsNothingText:
	text_far _NothingHappenedText
	text_end
EditorMBStatsRoseText:
	text_far _MonsStatsRoseText
	text_far _RoseText
	text_end
EditorMBStatsGreatlyRoseText:
	text_far _MonsStatsRoseText
	text_pause
	text_far _GreatlyRoseText
	text_far _RoseText
	text_end
EditorMBStatsFellText:
	text_far _MonsStatsFellText
	text_far _FellText
	text_end
EditorMBStatsGreatlyFellText:
	text_far _MonsStatsFellText
	text_pause
	text_far _GreatlyFellText
	text_far _FellText
	text_end
`;

// These small entry points share the original battle bank, so they can pass
// register arguments to native routines with ordinary CALLs. The larger control
// routine above remains in its own bank. No inline bank switch runs from ROMX.
export const nativeStatHelpers = `
EditorMBStatsDecodeIndex:
	ld a, [wCalculateWhoseStats]
	ld b, a
	srl a
	ld c, a
	ld a, b
	and 1
	ld [wCalculateWhoseStats], a
	ret

EditorMBStatsNameNative::
	call EditorMBStatsDecodeIndex
	ld b, c
	inc b
	jp PrintStatText

EditorMBStatsRecalculateNative::
	call EditorMBStatsDecodeIndex
	push bc
	call CalculateModifiedStat
	ld a, [wCalculateWhoseStats]
	and a
	jr nz, .penalty
	ld a, [wLinkState]
	cp LINK_STATE_BATTLING
	jr z, .penalty
	ld a, [wObtainedBadges]
	ld b, c
	inc b
.badge
	dec b
	jr z, .badgeReady
	srl a
	srl a
	jr .badge
.badgeReady
	bit 0, a
	jr z, .penalty
	push bc
	ld b, 0
	sla c
	ld hl, wBattleMonAttack
	add hl, bc
	call ApplyBadgeStatBoosts.applyBoostToStat
	pop bc
.penalty
	ldh a, [hWhoseTurn]
	push af
	ld a, [wCalculateWhoseStats]
	xor 1
	ldh [hWhoseTurn], a
	ld a, c
	and a
	jr nz, .speed
	call HalveAttackDueToBurn
	jr .restored
.speed
	cp 2
	jr nz, .restored
	call QuarterSpeedDueToParalysis
.restored
	pop af
	ldh [hWhoseTurn], a
	pop bc
	ret

`;
