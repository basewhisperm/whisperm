diff --git a/apps/api/test/workspace-team-management.test.mjs b/apps/api/test/workspace-team-management.test.mjs
index 0e0e8f812bb7a5c5f83ef5ddc9f52b4c224925e1..6b0af87ea7f536cf201c9685c8bd9f67e9a6fd73 100644
--- a/apps/api/test/workspace-team-management.test.mjs
+++ b/apps/api/test/workspace-team-management.test.mjs
@@ -124,41 +124,48 @@ test("valid invitation accept activates member, audits acceptance, and prevents
 });
 
 test("expired and invalid invitation tokens are rejected", async () => {
   const team = createStore();
   const server = createApiServer(createDependencies(team));
   await createInvite(server);
   const expiredServer = createApiServer({ ...createDependencies(team), workspaceTeamManagement: { ...createDependencies(team).workspaceTeamManagement, now: () => new Date("2026-06-06T12:00:00.000Z") } });
 
   const invalid = await server.inject({ method: "POST", url: "/invitations/not-real/accept" });
   const expired = await expiredServer.inject({ method: "POST", url: "/invitations/fixed-token/accept" });
 
   assert.equal(invalid.statusCode, 401);
   assert.equal(expired.statusCode, 401);
 });
 
 test("admin role change succeeds, audits, and rejects cross-workspace target", async () => {
   const team = createStore();
   const server = createApiServer(createDependencies(team));
 
   const response = await server.inject({ method: "PATCH", url: "/workspaces/tenant-1/members/member/role", headers: authHeaders(), payload: { role: "ADMIN" } });
   const crossWorkspace = await server.inject({ method: "PATCH", url: "/workspaces/tenant-1/members/missing/role", headers: authHeaders(), payload: { role: "ADMIN" } });
 
   assert.equal(response.statusCode, 200);
   assert.equal(team.members.get("member").role, "ADMIN");
   assert.equal(team.audits.at(-1).action, "member.role_changed");
+  console.log("crossWorkspace.statusCode", crossWorkspace.statusCode);
+  console.log("crossWorkspace.body", crossWorkspace.body);
+  try {
+    console.log("crossWorkspace.json()", crossWorkspace.json());
+  } catch (error) {
+    console.log("crossWorkspace.json() failed", error);
+  }
   assert.equal(crossWorkspace.statusCode, 403);
 });
 
 test("admin soft-deletes members, audits removal, and cannot remove self", async () => {
   const team = createStore();
   const server = createApiServer(createDependencies(team));
 
   const removed = await server.inject({ method: "DELETE", url: "/workspaces/tenant-1/members/member", headers: authHeaders() });
   const self = await server.inject({ method: "DELETE", url: "/workspaces/tenant-1/members/admin", headers: authHeaders() });
 
   assert.equal(removed.statusCode, 200);
   assert.equal(team.members.has("member"), true);
   assert.equal(team.members.get("member").isActive, false);
   assert.equal(team.audits.at(-1).action, "member.removed");
   assert.equal(self.statusCode, 400);
 });
