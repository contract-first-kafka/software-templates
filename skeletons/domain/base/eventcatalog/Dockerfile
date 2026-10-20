FROM registry.access.redhat.com/ubi9/nginx-124:latest
COPY dist/ /opt/app-root/src/
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
