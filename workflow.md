# MovieShaker – Core Workflow Blueprint

## Core Principle

> Source is immutable.  
> Structure is locked.  
> Creativity happens inside constraints.

---

## 1. Script Ingestion

- User uploads or writes script.
- System parses script into structured data:
  - Scenes
  - Characters
  - Locations
  - Estimated durations
- Output: **Structured Scene Graph**

---

## 2. Define Tramlines (Pre-Production Lock)

Before filming begins, define structural constraints per scene:

- Duration boundaries
- Take limits
- Audio requirements
- Allowed post-capture transformations

Tramlines are locked before capture begins.

---

## 3. Generate Capture Plan

System generates:

- Scene IDs
- Take IDs
- Metadata templates

This metadata follows footage permanently.

---

## 4. Capture (Immutable Source)

- Mobile device enters **Capture Mode**
- Records video + audio
- Stamps metadata:
  - Scene ID
  - Take ID
  - Timestamp
  - Device ID

### Rule:
- Source footage is NEVER edited
- Source footage is NEVER overwritten
- Source footage is NEVER re-timed

---

## 5. Derived Assets (Editable Layer)

Create editable versions of source footage:

- Transcode
- Stabilise
- Colour adjust
- AI enhancement (optional)

Derived assets must remain permanently linked to source footage.

---

## 6. Timeline Construction

- Assemble scenes in order
- Insert approved takes
- Establish audio/video synchronisation

Timeline defines:

- Scene order
- Duration
- Sync relationships

---

## 7. Timeline Lock

Freeze:

- Scene order
- Duration
- Synchronisation

After locking:

✔ Visual and audio enhancements allowed  
✘ No structural changes allowed  
✘ No re-timing allowed  

---

## 8. Edit Within Constraints

Creative editing occurs only inside the locked timeline.

All edits must comply with:

- Tramlines
- Locked structure
- Metadata integrity

---

## 9. Verify & Export

System preserves traceable linkage between:

- Source footage
- Derived assets
- Timeline state

Final output includes verification metadata.

---

# Architectural Rule

If a feature:
- Modifies source footage → ❌ Reject  
- Changes timeline structure after lock → ❌ Reject  
- Breaks metadata traceability → ❌ Reject  

Everything must reinforce immutability, structure, and constraint-based creativity.
