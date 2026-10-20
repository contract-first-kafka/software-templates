FROM registry.access.redhat.com/ubi9/nodejs-24-minimal@sha256:cfca5c8d4d7babc8b74f408db216c2fd4dec872f319c1579e001dcceb51d3058 AS dependencies
WORKDIR /opt/app-root/src
COPY .runtime/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache=/tmp/npm-cache && rm -rf /tmp/npm-cache

FROM registry.access.redhat.com/ubi9/nodejs-24-minimal@sha256:cfca5c8d4d7babc8b74f408db216c2fd4dec872f319c1579e001dcceb51d3058
USER 0
WORKDIR /opt/app-root/src
COPY --from=dependencies /opt/app-root/src/node_modules ./node_modules
COPY .runtime/ ./
# EventCatalog 5.4.1's native MCP service-schema reader uses /generated URLs as file paths.
RUN ln -s /opt/app-root/src/dist/client/generated /generated && chmod -R a+rX /opt/app-root/src
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 HOME=/tmp
USER 1001
EXPOSE 8080
CMD ["node", "node_modules/@eventcatalog/core/bin/eventcatalog.js", "start"]
