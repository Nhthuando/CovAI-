import {it, expect} from '@jest/globals';
import {describeAssertionOutcome, outcomeBindings, isVagueExpectedOutcome} from '../services/systemExpectedOutcome.service.js';

it('preserves the actual text and negation instead of reducing outcomes to Visible',()=>{
    expect(describeAssertionOutcome("expect(page.locator('text=Keep Title')).toBeVisible()")).toBe('Text "Keep Title" is visible.');
    expect(describeAssertionOutcome("expect(page.locator('text=Changed Title')).not.toBeVisible()")).toBe('Text "Changed Title" is not visible.');
});
it('resolves a local named control and retains the expected input value',()=>{
    const bindings=outcomeBindings("const titleInput=page.getByRole('textbox',{name:'Task title'});");
    expect(describeAssertionOutcome("await expect(titleInput).toHaveValue('Original title');",bindings)).toBe('Textbox "Task title" has value "Original title".');
    expect(describeAssertionOutcome('expect(response.status()).toBe(201)')).toBe('Response status equals 201.');
});
it('leaves unsupported expressions for review and identifies vague legacy labels',()=>{
    expect(describeAssertionOutcome('expect(complex()).customMatcher()')).toBeNull();
    expect(isVagueExpectedOutcome('The asserted value is visible')).toBe(true);
    expect(isVagueExpectedOutcome('The asserted value has value 12')).toBe(true);
    expect(isVagueExpectedOutcome('Text "Receipt" is visible.')).toBe(false);
});
