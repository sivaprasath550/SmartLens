import { useState, type FormEvent } from 'react';
import { getDashboardKey, setDashboardKey } from '../api/client';

export function AccessKeyForm({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState(getDashboardKey());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setDashboardKey(value.trim());
    onSubmit();
  };

  return (
    <form className="card access-form" onSubmit={submit}>
      <h2>Dashboard access key required</h2>
      <p className="muted">
        This backend has <code>DASHBOARD_ACCESS_KEY</code> set. Enter the key to view location data. It is kept only for
        this browser tab.
      </p>
      <div className="row">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Access key"
          autoComplete="current-password"
          aria-label="Dashboard access key"
        />
        <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
          Unlock
        </button>
      </div>
    </form>
  );
}
