# NetBox → Builder Deep Links — Design

> Status: builder-side hooks IMPLEMENTED; plugin-side callout NOT implemented
> (no NetBox changes yet, by request). This documents both halves so the
> plugin work can be picked up later without re-deriving the contract.

## Goal

From a netbox-load-balancer object page (say a BackendPool whose
`extra_parameters` needs editing), jump straight into the AS3 Builder with
that object's application loaded and the cursor/panel focused on exactly that
object — edit with schema help, then Push back.

## URL contract (implemented in the builder)

```text
<builder-origin>/?netbox=<netbox-origin>
                &app=<application-id>
                &object=<endpoint>:<object-id>
                &focus=<field>
```

| Param | Example | Effect in the builder |
| --- | --- | --- |
| `netbox` | `http://localhost:8080` | Prefills the NetBox URL and auto-opens the Load dialog. Required for any deep link. |
| `app` | `773` | After the user connects (credentials are typed or come from the in-session cache — never from the URL), this application loads automatically. |
| `object` | `backend-pools:957` | After loading, the provenance manifest maps endpoint:id → the AS3 key, and the cursor jumps there; the context panel, breadcrumb, and status bar all show that object. Supported endpoints: `applications`, `virtual-servers`, `backend-pools`, `monitors`, `ssl-profiles`. |
| `focus` | `extra_parameters` | Highlight hint. `extra_parameters` flashes exactly the properties that map to the NetBox extras field (the complement of the modeled properties); any other value flashes that named AS3 property. |

Example — "edit the extras of pool 957 in app 773":

```text
http://localhost:5173/?netbox=http://localhost:8080&app=773&object=backend-pools:957&focus=extra_parameters
```

Security note: the URL carries **no credentials**. The user authenticates in
the dialog (or rides the cached in-memory token). The `netbox` param only
prefills the URL field the user can see and change.

## Plugin-side callout (future, NOT implemented)

Smallest viable version — no new models, one plugin setting, one template
extension:

1. **Setting** in `PLUGINS_CONFIG['netbox_load_balancer']`:
   `as3_builder_url: "https://builder.example.com"`. Absent → no buttons
   rendered.
2. **Template extensions** (`template_content.py`, `buttons()` hook) for
   Application, VirtualServer, BackendPool, Monitor, SSLProfile detail pages:
   render an "Edit in AS3 Builder" button linking to
   `{as3_builder_url}/?netbox={request.scheme}://{request.get_host()}
   &app={application id}&object={endpoint}:{pk}`.
   - For non-Application objects the application id comes from the object's
     application linkage (VirtualServer.applications.first(); pools/monitors
     via their referencing virtual server). Objects reachable from multiple
     applications can render one button per app or pick the first.
   - On the `extra_parameters` panel specifically, add `&focus=extra_parameters`.
3. Optionally the same button as a table row action.

That's the whole plugin footprint. Everything else already exists in the
builder.

## "Show just the relevant section" — current behavior and future option

Today the deep link lands the cursor on the object: the context panel shows
its properties (the extras flashed), the tree highlights it, and the editor
scrolls to it. The rest of the declaration stays visible, which keeps
cross-references (xref dropdowns, drag targets) working.

A future **solo mode** (`&solo=1`) could additionally:

- collapse the tree to the focused object,
- fold all other objects in Monaco (`editor.createFoldingRangeProvider` or
  `setHiddenAreas`) so only the focused object's lines show,
- filter the Push preview to that object.

`setHiddenAreas` is the clean mechanism (already used by diff editors); the
folding data comes from the same jsonc AST we use everywhere. Not built yet —
the deep-link plumbing was designed so solo mode is purely additive.

## Round-trip flow

1. NetBox page → builder URL (above).
2. Builder opens Load dialog prefilled; user authenticates once per session.
3. App loads; cursor lands on the object; extras flash.
4. User edits (schema-validated, xref dropdowns, etc.).
5. **Push to NetBox…** → the standard preview (the extras edit appears as an
   `extra_parameters` field change on that object) → apply → NetBox updated;
   builder reloads the round-tripped truth.
