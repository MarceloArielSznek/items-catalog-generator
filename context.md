# Attic Projects Catalog Composer — Context

## Project Overview

We are building an internal web application for Attic Projects.

The purpose of this app is to generate professional catalog-style proposal images using exactly three uploaded visual assets:

1. A background image
2. An item/product image
3. A company logo image

The output should be a single polished marketing image where:
- the background remains the main stage/environment
- the item is placed naturally into the scene
- the logo is added in a clean branded position
- the final result looks like a professional catalog/proposal visual

This tool is for attic and crawl space service-related proposal assets.

Examples of items:
- fiberglass batt insulation
- asbestos encapsulant bucket
- crawl space fan
- ducting-related components
- rodent proofing materials
- air sealing products
- attic equipment

## Core Goal

This is NOT a creative design tool.
This is NOT a Canva alternative.
This is NOT a drag-and-drop editor.

This is a guided composition workflow.

The job of the system is:
- combine the uploaded background, item, and logo
- preserve identity of the uploaded assets
- create a realistic final branded image
- avoid changing the item or logo unnecessarily

## Non-Negotiable Business Rules

The system must preserve:
- the uploaded product identity
- the uploaded logo identity
- the uploaded background as the main scene

The model should NOT:
- redesign the product
- hallucinate a different logo
- replace real text with fake text
- add people
- introduce unrelated objects
- transform the scene into fantasy or cinematic artwork
- alter the brand

The system should behave like a professional catalog image composer.

## Desired Output Style

The desired image style is:
- realistic
- bright professional
- clean
- proposal-friendly
- contractor catalog quality
- subtle and credible
- visually polished but not exaggerated

The final image should feel like:
- a real product placed in a real attic/crawl space stage
- professional but believable
- optimized for proposals, contracts, website galleries, and sales materials

## UX Philosophy

The user should do only a few things:
1. upload background
2. upload item
3. upload logo
4. optionally add item name or short instruction
5. click generate
6. preview and download result

No complex editing tools.
No manual design canvas in MVP.
No layer timeline.
No advanced design controls.

## Technical Direction

Frontend:
- React
- simple, clean internal tool UI
- desktop-first
- image previews
- loading states
- result preview and download

Backend:
- Node.js
- Express
- multipart file upload handling
- OpenAI image editing/generation integration
- temporary file storage for MVP
- modular service structure

## Recommended MVP Behavior

The MVP should work like this:

1. User uploads:
   - background image
   - item image
   - logo image

2. Backend validates file types and size

3. Backend performs deterministic composition first when possible:
   - background becomes canvas
   - item is centered and scaled
   - logo is placed bottom-left or bottom-right
   - composition is prepared as a base image

4. OpenAI image editing API is then used to improve realism:
   - blend item into environment
   - add realistic contact shadow
   - align lighting
   - preserve logo faithfully
   - preserve item faithfully

5. Final result is returned and displayed

## Important Engineering Principle

We should not rely on the model alone for layout precision.

Whenever possible:
- use regular image processing for fixed placement
- use the model only for visual integration
- preserve control in backend logic

This reduces hallucination and drift.

## Future Improvements

Possible future features:
- transparent PNG item support
- auto-background removal for products
- multiple layout presets
- batch generation
- asset history
- preset logo positions
- side-by-side comparison
- retry with prompt variations
- cloud storage
- auth and user accounts
- brand template library

## Success Criteria

A successful result:
- clearly shows the original item
- keeps the original logo recognizable
- keeps the original background as scene base
- looks realistic and professional
- feels like a polished catalog image
- can be used directly in proposals

## Failure Cases to Avoid

Unacceptable outputs:
- fake or altered brand logo
- wrong object generated instead of uploaded item
- item drastically changing shape
- label text becoming gibberish if important branding must remain
- overdramatic lighting
- added humans
- random construction clutter in the focal center
- excessive stylization
- poor scale or floating object look

## Product Intent Summary

This app is a composition and realism tool.

It should:
- place
- preserve
- blend
- brand

It should NOT:
- redesign
- invent
- restyle
- improvise unnecessarily