function formatDisplayDate(dateString: string): string {
  const [year, month, day] = dateString.split("-");
  return `${month}-${day}-${year}`;
}

type DateNavigatorProps = {
  availableDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

export function DateNavigator({
  availableDates,
  selectedDate,
  onSelectDate,
}: DateNavigatorProps) {
  const currentIndex = availableDates.indexOf(selectedDate);
  const resolvedIndex =
    currentIndex >= 0 ? currentIndex : availableDates.length - 1;
  const resolvedDate =
    resolvedIndex >= 0 ? availableDates[resolvedIndex] : selectedDate;
  const hasEarlierDate = resolvedIndex > 0;
  const hasLaterDate =
    resolvedIndex >= 0 && resolvedIndex < availableDates.length - 1;

  const handlePrevious = () => {
    if (!hasEarlierDate) return;
    onSelectDate(availableDates[resolvedIndex - 1]);
  };

  const handleNext = () => {
    if (!hasLaterDate) return;
    onSelectDate(availableDates[resolvedIndex + 1]);
  };

  return (
    <div className="date-nav" aria-label="Available game dates">
      <button
        type="button"
        className="date-nav__arrow"
        onClick={handlePrevious}
        disabled={!hasEarlierDate}
        aria-label="Show earlier available game date"
      >
        ‹
      </button>

      <div className="date-nav__value">{formatDisplayDate(resolvedDate)}</div>

      <button
        type="button"
        className="date-nav__arrow"
        onClick={handleNext}
        disabled={!hasLaterDate}
        aria-label="Show later available game date"
      >
        ›
      </button>
    </div>
  );
}
