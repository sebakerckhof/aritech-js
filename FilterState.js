/**
 * FilterState - Parses filterStatus into a friendly object
 * Filters are read-only entities with a simple on/off state
 */

import { messageTemplates } from './messages.js';
import { getAllProperties as _getAllProperties } from './message-helpers.js';

const getAllProperties = _getAllProperties.bind(null, messageTemplates);

export default class FilterState {
    constructor() {
        this.isActive = false;
        this.rawFlags = {};
    }

    static fromBytes(bytes) {
        const state = new FilterState();
        if (!bytes || bytes.length < 5) return state;

        state.rawFlags = getAllProperties('filterStatus', bytes);
        Object.assign(state, state.rawFlags);

        return state;
    }

    toString() {
        return this.isActive ? 'Active' : 'Inactive';
    }
}
