type TransactionView =
  | { type: "cut"; text: string }
  | { type: "trade"; text: string };

type CutHistoryProps = {
  items?: TransactionView[];
};

export function CutHistory({ items = [] }: CutHistoryProps) {
  return (
    <div className="row-cell row-cell--history cut-history">
      <div className="cut-history__title">Transactions</div>
      <div className="cut-history__list">
        {items.length === 0 ? (
          <div className="cut-history__empty">None yet</div>
        ) : (
          items.map((item, index) => (
            <div
              key={index}
              className={`cut-card ${
                item.type === "trade" ? "cut-card--trade" : ""
              }`}
            >
              <div className="cut-card__name">{item.text}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
