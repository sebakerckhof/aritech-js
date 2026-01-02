/**
 * DoorState - Parses doorStatus into a friendly object
 */

import { messageTemplates } from './messages.js';
import { getAllProperties as _getAllProperties } from './message-helpers.js';

const getAllProperties = _getAllProperties.bind(null, messageTemplates);

export default class DoorState {
    constructor() {
        // Byte 4 flags
        this.isDisabled = false;
        this.isUnlocked = false;
        this.isUnlockedPeriod = false;
        this.isTimeUnlocked = false;
        this.isStandardTimeUnlocked = false;
        this.isOpened = false;
        this.isForced = false;
        this.isDoorOpenTooLong = false;
        // Byte 5 flags
        this.isShunting = false;
        this.isShuntWarning = false;
        this.isReaderFault = false;
        this.isReaderTamper = false;
        this.isUnsecured = false;
        this.isInputActive = false;
        this.isOutputActive = false;
        this.rawFlags = {};
    }

    static fromBytes(bytes) {
        const state = new DoorState();
        if (!bytes || bytes.length < 6) return state;

        state.rawFlags = getAllProperties('doorStatus', bytes);
        Object.assign(state, state.rawFlags);

        return state;
    }

    get isLocked() {
        // Door is locked if not unlocked in any way
        return !this.isUnlocked && !this.isUnlockedPeriod && !this.isTimeUnlocked && !this.isStandardTimeUnlocked;
    }

    toString() {
        const states = [];

        // Lock state
        if (this.isUnlocked || this.isStandardTimeUnlocked || this.isTimeUnlocked || this.isUnlockedPeriod) states.push('Unlocked');
        else states.push('Locked');
        if (this.isUnlocked) states.push('FullUnlocked');
        if (this.isTimeUnlocked) states.push('TimeUnlocked');
        if (this.isStandardTimeUnlocked) states.push('StandardTimeUnlocked');
        if (this.isUnlockedPeriod) states.push('PeriodUnlocked');

        // Open state
        if (this.isOpened) states.push('Opened');

        // Alarm states
        if (this.isForced) states.push('Forced');
        if (this.isDoorOpenTooLong) states.push('OpenTooLong');
        if (this.isDisabled) states.push('Disabled');

        // Fault states
        if (this.isReaderFault) states.push('ReaderFault');
        if (this.isReaderTamper) states.push('ReaderTamper');
        if (this.isUnsecured) states.push('Unsecured');

        return states.join(', ');
    }
}
