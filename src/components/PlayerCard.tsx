type HeadshotCellProps = {
  name: string;
  headshotUrl?: string;
};

type IdentityCellProps = {
  name: string;
  position: "PG" | "SG" | "SF" | "PF" | "C";
  team: string;
};

export function HeadshotCell({
  name,
  headshotUrl,
}: HeadshotCellProps) {
  return (
    <div className="row-cell row-cell--headshot">
      {headshotUrl ? (
        <img
          src={headshotUrl}
          alt={`${name} headshot`}
          className="row-cell__headshot-image"
        />
      ) : (
        <div className="row-cell__headshot-fallback" />
      )}
    </div>
  );
}

export function IdentityCell({
  name,
  position,
  team,
}: IdentityCellProps) {
  return (
    <div className="row-cell row-cell--identity">
      <div className="row-cell__name">{name}</div>
      <div className="row-cell__position">{position}</div>
      <div className="row-cell__team">{team}</div>
    </div>
  );
}
