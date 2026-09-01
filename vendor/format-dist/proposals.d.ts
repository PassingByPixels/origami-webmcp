import type { DeckModel, Op } from './model.js';
/** The ops a proposal can stage: edit (slide.inner), add (slide.insert), delete
    (slide.remove), or hide (slide.meta). */
export type ProposalOp = Extract<Op, {
    t: 'slide.inner' | 'slide.insert' | 'slide.remove' | 'slide.meta';
}>;
export interface Proposal {
    id: string;
    author: string;
    title: string;
    prompt?: string;
    /** The staged op — applied only on accept. */
    op: ProposalOp;
    /** The chunk this proposal targets (an existing chunk for edit/delete/hide; the NEW id for add). */
    targetId: string;
    /** sha256 of targetId's inner at propose time. Edits conflict if it no longer matches; add has none. */
    baseHash: string;
}
export type ProposalAction = 'edit' | 'add' | 'delete' | 'hide';
export interface ProposalView {
    id: string;
    author: string;
    title: string;
    prompt?: string;
    action: ProposalAction;
    targetId: string;
    /** The chunk's CURRENT inner (the review "before"). undefined for an add, or if the chunk is gone. */
    before?: string;
    /** The proposed inner (the review "after"). Present for edit/add. */
    after?: string;
    /** True if applying would no longer be clean: an edit whose chunk changed since, or a
        delete/hide whose chunk is already gone. add never conflicts. */
    conflicted: boolean;
}
/** A reviewable view of a proposal against the live model: action + before/after + a conflict flag.
    `currentInnerHash` is the sha256 of the target chunk's CURRENT inner (undefined if the chunk is
    gone) — the caller computes it (Node or Web Crypto) so this stays runtime-agnostic. */
export declare function proposalView(p: Proposal, model: DeckModel, currentInnerHash: string | undefined): ProposalView;
