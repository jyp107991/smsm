/**
 * The two people as the screens need them: names and animals in the order they joined, who "me" is on this
 * phone (whoever is holding it), and the partner once they have joined.
 */
import { useMemo } from 'react';
import { useMembers, useSession, type MemberRow } from '../../data';
import type { NameOf, Person } from './words';

export interface People {
  /** Both, or one before the partner joins, in the order they joined. Only people who have set a name. */
  list: Person[];
  me: Person | null;
  partner: Person | null;
  /** My own member row (null before the household exists); `locked_at` set once name and animal are saved. */
  myRow: MemberRow | null;
  rows: MemberRow[];
  name: NameOf;
  /** Known only once the members are on the phone. */
  ready: boolean;
}

function person(m: MemberRow, index: number): Person {
  const animal = m.animal === 'cat' || m.animal === 'dog' ? m.animal : index === 0 ? 'cat' : 'dog';
  return { id: m.user_id, name: m.display_name ?? '', animal };
}

export function usePeople(): People {
  const session = useSession();
  const members = useMembers();
  const uid = session.status === 'signed-in' ? session.userId : null;
  return useMemo(() => {
    const rows = members.data ?? [];
    const all = rows.map(person);
    const list = rows.map((m, i) => (m.locked_at !== null || m.display_name !== null ? all[i] : undefined)).filter((p): p is Person => p !== undefined);
    const me = all.find((p) => p.id === uid) ?? null;
    const partner = list.find((p) => p.id !== uid) ?? null;
    const myRow = rows.find((m) => m.user_id === uid) ?? null;
    const name: NameOf = (id) => all.find((p) => p.id === id)?.name ?? '';
    return { list, me, partner, myRow, rows, name, ready: members.data !== undefined };
  }, [members.data, uid]);
}
