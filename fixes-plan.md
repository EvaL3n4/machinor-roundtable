# Machinor Roundtable - Bug Fixes Plan

## Issues Reported
1. **Duplicate cogwheel emoji** in settings header (line 4)
2. **Connection profile selection** not working
3. **Plot generation** not working

## Fix 1: Remove Duplicate Cogwheel Emoji
**File:** `settings.html`
**Line:** 4
**Current:** `<h3>⚙️ Machinor Roundtable</h3>`
**Fix:** Remove the emoji since the settings panel already has a cogwheel icon

## Fix 2: Connection Profile Selection Not Working
**File:** `index.js`
**Issue:** The connection profile dropdown exists in settings.html but has no event handler in index.js
**Solution:** Add event binding and settings persistence

### Changes needed:
1. Add `mr_connection_profile` to defaultSettings in index.js
2. Add event handler `onConnectionProfileChange` in index.js
3. Bind the event in `bindEvents()` function
4. Load the saved value in `loadSettings()` function

## Fix 3: Plot Generation Not Working
**Files:** `plot-engine.js`, `index.js`
**Potential Issues:**
1. `generateQuietPrompt` import might be incorrect
2. API call parameters might be wrong
3. Error handling might be swallowing the real error

### Debug Steps:
1. Check if `generateQuietPrompt` is correctly imported from script.js
2. Add console.log before and after the API call
3. Check if character data is being passed correctly
4. Verify the prompt format is correct

### Implementation Order:
1. Fix duplicate cogwheel (easiest)
2. Add connection profile event handling
3. Debug plot generation with console logs
4. Test full workflow

## Testing Checklist
- [ ] Settings header shows only one cogwheel
- [ ] Connection profile selection saves and persists
- [ ] Manual plot generation works
- [ ] Auto-generation triggers correctly
- [ ] Plot injection works in chat
- [ ] All console errors resolved