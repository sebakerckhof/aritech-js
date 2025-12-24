/**
 * AreaState - Parses areaStatus into a friendly object
 */

import { messageTemplates } from './messages.js';
import { getAllProperties as _getAllProperties } from './message-helpers.js';

const getAllProperties = _getAllProperties.bind(null, messageTemplates);

export default class AreaState {
    constructor() {
        this.isFullSet = false;
        this.isPartiallySet = false;
        this.isPartiallySet2 = false;
        this.isUnset = false;
        this.isAlarming = false;
        this.isAlarmAcknowledged = false;
        this.isTampered = false;
        this.isExiting = false;
        this.isEntering = false;
        this.isReadyToArm = false;
        this.hasFire = false;
        this.hasPanic = false;
        this.hasMedical = false;
        this.hasTechnical = false;
        this.hasDuress = false;
        this.hasActiveZones = false;
        this.hasInhibitedZones = false;
        this.hasIsolatedZones = false;
        this.hasZoneFaults = false;
        this.hasZoneTamper = false;
        this.isBuzzerActive = false;
        this.isInternalSiren = false;
        this.isExternalSiren = false;
        this.isStrobeActive = false;
        this.rawFlags = {};
    }

    static fromBytes(bytes) {
        const state = new AreaState();
        if (!bytes || bytes.length < 4) return state;

        state.rawFlags = getAllProperties('areaStatus', bytes);
        Object.assign(state, state.rawFlags);

        return state;
    }

    toString() {
        const states = [];
        if (this.isFullSet) states.push('Armed');
        else if (this.isPartiallySet) states.push('Part-Armed');
        else if (this.isPartiallySet2) states.push('Part-Armed 2');
        else if (this.isUnset) states.push('Disarmed');
        if (this.isAlarming) states.push('ALARM');
        if (this.isExiting) states.push('Exit');
        if (this.isEntering) states.push('Entry');
        if (this.isReadyToArm) states.push('Ready');
        return states.join(', ') || 'Unknown';
    }
}
