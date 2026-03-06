import { COMPOSITION_DEFAULTS } from "../../../shared/constants/imageRules.js";

const MIN_SCALE = 0.10;
const MAX_SCALE = 0.80;
const SCALE_STEP = 0.01;

const MIN_SHADOW = 0;
const MAX_SHADOW = 1;
const SHADOW_STEP = 0.05;

export default function ItemPreviewComposite({
  backgroundUrl,
  itemPreviewUrl,
  scale,
  onScaleChange,
  shadowIntensity,
  onShadowIntensityChange,
}) {
  const scalePct = Math.round(scale * 100);
  const shadowPct = Math.round(shadowIntensity * 100);

  const contactOpacity = COMPOSITION_DEFAULTS.contactShadowOpacity * shadowIntensity;
  const ambientBlur = Math.round(COMPOSITION_DEFAULTS.ambientShadowBlur * shadowIntensity);
  const ambientOpacity = COMPOSITION_DEFAULTS.ambientShadowOpacity * shadowIntensity;

  return (
    <div className="composite-preview">
      <label className="composite-preview__heading">Preview</label>

      <div className="composite-preview__canvas">
        <img
          className="composite-preview__bg"
          src={backgroundUrl}
          alt="Background"
          draggable={false}
        />

        {itemPreviewUrl && (
          <div
            className="composite-preview__item-wrap"
            style={{
              width: `${scale * 100}%`,
              height: `${scale * 100}%`,
              top: `${COMPOSITION_DEFAULTS.itemVerticalBias * 100}%`,
              left: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            <img
              className="composite-preview__item"
              src={itemPreviewUrl}
              alt="Item"
              draggable={false}
              style={{
                filter: `drop-shadow(0 ${ambientBlur}px ${ambientBlur * 2}px rgba(0,0,0,${ambientOpacity}))`,
              }}
            />
            {shadowIntensity > 0 && (
              <div
                className="composite-preview__contact-shadow"
                style={{ opacity: contactOpacity }}
              />
            )}
          </div>
        )}
      </div>

      <div className="composite-preview__controls">
        <div className="composite-preview__slider-group">
          <label className="composite-preview__scale-label">
            Item Size: <strong>{scalePct}%</strong>
          </label>
          <div className="composite-preview__slider-row">
            <span className="composite-preview__slider-bound">Small</span>
            <input
              className="composite-preview__slider"
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={SCALE_STEP}
              value={scale}
              onChange={(e) => onScaleChange(parseFloat(e.target.value))}
            />
            <span className="composite-preview__slider-bound">Large</span>
          </div>
        </div>

        <div className="composite-preview__slider-group">
          <label className="composite-preview__scale-label">
            Shadow: <strong>{shadowPct}%</strong>
          </label>
          <div className="composite-preview__slider-row">
            <span className="composite-preview__slider-bound">None</span>
            <input
              className="composite-preview__slider"
              type="range"
              min={MIN_SHADOW}
              max={MAX_SHADOW}
              step={SHADOW_STEP}
              value={shadowIntensity}
              onChange={(e) => onShadowIntensityChange(parseFloat(e.target.value))}
            />
            <span className="composite-preview__slider-bound">Strong</span>
          </div>
        </div>
      </div>
    </div>
  );
}
