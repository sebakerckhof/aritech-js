/**
 * TriggerState - Parses triggerStatus into a friendly object
 */

import { messageTemplates } from './messages.x500.js';
import { getAllProperties as _getAllProperties } from './message-helpers.js';

const getAllProperties = _getAllProperties.bind(null, messageTemplates);

export default class TriggerState {
    constructor() {
        this.isRemoteOutput = false;
        this.isFob = false;
        this.isKeyfobSwitch1 = false;
        this.isKeyfobSwitch2 = false;
        this.isKeyfobSwitch12 = false;
        this.isSchedule = false;
        this.isFunctionKey = false;
        this.rawFlags = {};
    }

    static fromBytes(bytes) {
        const state = new TriggerState();
        if (!bytes || bytes.length < 5) return state;

        state.rawFlags = getAllProperties('triggerStatus', bytes);
        Object.assign(state, state.rawFlags);

        return state;
    }

    get isActive() {
        // Trigger is active if any activation source is true
        return this.isRemoteOutput || this.isFob || this.isKeyfobSwitch1 ||
               this.isKeyfobSwitch2 || this.isKeyfobSwitch12 || this.isSchedule || this.isFunctionKey;
    }

    toString() {
        const sources = [];
        if (this.isRemoteOutput) sources.push('RemoteOut');
        if (this.isFob) sources.push('Fob');
        if (this.isKeyfobSwitch1) sources.push('KeyfobSw1');
        if (this.isKeyfobSwitch2) sources.push('KeyfobSw2');
        if (this.isKeyfobSwitch12) sources.push('KeyfobSw12');
        if (this.isSchedule) sources.push('Schedule');
        if (this.isFunctionKey) sources.push('FKey');
        return sources.length > 0 ? `Active (${sources.join(', ')})` : 'Inactive';
    }
}
