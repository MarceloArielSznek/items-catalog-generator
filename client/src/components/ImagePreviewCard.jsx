export default function ImagePreviewCard({ src, name }) {
  return (
    <div className="image-preview">
      <img className="image-preview__img" src={src} alt={name} />
      <div className="image-preview__name">{name}</div>
    </div>
  );
}
