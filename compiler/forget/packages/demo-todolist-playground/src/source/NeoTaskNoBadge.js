/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useRef } from "react";
import CountBadge from "../Components/CountBadge";

/**
 *  Until Forget supports default props...
 */
export default function Todo({ todo, onChange }) {
  const inputRef = useRef(null);
  const count = useRef(0);
  const [isEditing, setIsEditing] = useState(false);

  const onSave = e => {
    e.preventDefault();
    setIsEditing(false);
    onChange({
      ...todo,
      text: inputRef.current.value,
    });
  };

  const todoBody = isEditing ? (
    <form value={todo.text} onSubmit={onSave} onBlur={onSave}>
      <input ref={inputRef} defaultValue={todo.text} autoFocus />
    </form>
  ) : (
    <div
      className={"TodoBody" + (todo.done ? " done" : "")}
      onClick={() => setIsEditing(true)}
    >
      {todo.text}
    </div>
  );

  const checkBox = !isEditing && (
    <button
      className={todo.done ? "Checkbox done" : "Checkbox"}
      onClick={e => {
        e.target.blur();
        onChange({
          ...todo,
          done: !todo.done,
        });
      }}
    ></button>
  );

  return (
    <li className="Todo">
      {checkBox}
      {todoBody}
      <div className="tail"></div>
    </li>
  );
}
