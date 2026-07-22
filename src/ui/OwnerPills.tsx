import { ownerColorClass } from './ownerColor'

// Owner name badges, coloured by name so each person is visually distinct (and
// so a multi-owner item clearly reads as several people, not one). The same
// person is the same colour everywhere (library, trip gear, the add-gear panel).

/** One coloured pill per owner. Renders nothing when there are no owners. Each
 *  pill carries a left margin so it drops in after an item name inline. */
export function OwnerPills({ owners }: { owners?: readonly string[] }) {
  if (!owners?.length) return null
  return (
    <>
      {owners.map((o) => (
        <span key={o} className={`ml-1 rounded px-1 text-xs ${ownerColorClass(o)}`}>
          {o}
        </span>
      ))}
    </>
  )
}
