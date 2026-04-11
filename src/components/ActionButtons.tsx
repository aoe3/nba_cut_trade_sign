type ActionButtonsProps = {
  disabled?: boolean;
  onSign: () => void;
  onCut: () => void;
  onTrade: () => void;
  canCut: boolean;
};

export function ActionButtons({
  disabled = false,
  onSign,
  onCut,
  onTrade,
  canCut,
}: ActionButtonsProps) {
  return (
    <div className="row-cell row-cell--buttons action-buttons">
      <button
        className="action-btn action-btn--sign"
        disabled={disabled}
        onClick={onSign}
      >
        Sign
      </button>

      <button
        className="action-btn action-btn--trade"
        disabled={disabled}
        onClick={onTrade}
      >
        Trade
      </button>

      <button
        className="action-btn action-btn--cut"
        disabled={disabled || !canCut}
        onClick={onCut}
      >
        Cut
      </button>
    </div>
  );
}
