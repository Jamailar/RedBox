import { promptLoader } from './loader';

export const OPENCODE_PROMPTS = {
    PLAN: promptLoader.load('opencode/plan.txt'),
    EXPLORE: promptLoader.load('opencode/explore.txt'),
    REASONING: promptLoader.load('opencode/reasoning.txt'),
};
