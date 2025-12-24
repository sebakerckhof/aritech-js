/**
 * OutputState - Parses outputStatus into a friendly object
 */

import { messageTemplates } from './messages.js';
import { getAllProperties as _getAllProperties } from './message-helpers.js';

const getAllProperties = _getAllProperties.bind(null, messageTemplates);

export default class OutputState {
    constructor() {
        this.isActive = false;
        this.isOn = false;
        this.isForced = false;
        this.rawFlags = {};
    }

    static fromBytes(bytes) {
        const state = new OutputState();
        if (!bytes || bytes.length < 5) return state;

        state.rawFlags = getAllProperties('outputStatus', bytes);
        Object.assign(state, state.rawFlags);

        return state;
    }

    toString() {
        const states = [];
        if (this.isOn) states.push('On');
        if (this.isActive) states.push('Active');
        if (this.isForced) states.push('Forced');
        return states.join(', ') || 'Off';
    }
}
