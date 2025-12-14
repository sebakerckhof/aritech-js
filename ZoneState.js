/**
 * ZoneState - Parses zoneStatus into a friendly object
 */

import { messageTemplates } from './messages.x500.js';
import { getAllProperties as _getAllProperties } from './message-helpers.js';

const getAllProperties = _getAllProperties.bind(null, messageTemplates);

export default class ZoneState {
    constructor() {
        this.isActive = false;
        this.isSet = false;
        this.isTampered = false;
        this.hasFault = false;
        this.isInhibited = false;
        this.isIsolated = false;
        this.isAlarming = false;
        this.isAntiMask = false;
        this.isInSoakTest = false;
        this.hasBatteryFault = false;
        this.isDirty = false;
        this.rawFlags = {};
    }

    static fromBytes(bytes) {
        const state = new ZoneState();
        if (!bytes || bytes.length < 4) return state;

        state.rawFlags = getAllProperties('zoneStatus', bytes);
        Object.assign(state, state.rawFlags);

        return state;
    }

    toString() {
        const states = [];
        if (this.isActive) states.push('Active');
        if (this.isSet) states.push('Armed');
        if (this.isAlarming) states.push('ALARM');
        if (this.isInhibited) states.push('Inhibited');
        if (this.isIsolated) states.push('Isolated');
        if (this.isTampered) states.push('Tamper');
        if (this.hasFault) states.push('Fault');
        return states.join(', ') || 'OK';
    }
}
