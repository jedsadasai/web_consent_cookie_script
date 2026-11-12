There are two ways to check it by hand. Method A is the easiest; Method B works without loading the image into Docker.

## Method A: Load the image and ask Node

**Step 1: Load the image from the tar file** (about 590 MB, takes a moment)
```bash
docker load -i ~/appointment/appointment.tar
```
The output should end with `Loaded image: appointment:1.6`.

**Step 2: Make sure the image is there**
```bash
docker images appointment
```

**Step 3: Print the Node version**
```bash
docker run --rm appointment:1.6 --version
```
This works because the image's entrypoint is already `/usr/local/bin/node`. Whatever you put after the image name goes to `node`, so this runs `node --version`. It should print `v24.22.3`.

If you'd rather name the binary yourself:
```bash
docker run --rm --entrypoint /usr/local/bin/node appointment:1.6 -v
```

> ⚠️ `docker run --rm appointment:1.6 sh -c "node -v"` will **not** work. The image is distroless and has no shell (`sh`, `bash`) inside.

**If a container is already running** from this image, you can ask it directly:
```bash
docker ps
```
```bash
docker exec <container-name> /usr/local/bin/node --version
```

**Step 4 (optional): Remove the image if you only loaded it to check**
```bash
docker rmi appointment:1.6
```

## Method B: Read the tar file without Docker (what I did)

**Step 1: Make a temporary folder**
```bash
mkdir -p ~/nodecheck
```

**Step 2: Find which layer contains the `node` binary**
```bash
for L in $(tar -tf ~/appointment/appointment.tar | grep '^blobs/sha256/.'); do tar -xOf ~/appointment/appointment.tar "$L" 2>/dev/null | tar -t 2>/dev/null | grep -q '^usr/local/bin/node$' && echo "$L"; done
```
It should print `blobs/sha256/47e1a0bb67bc...`.

**Step 3: Extract only the binary from that layer**
```bash
tar -xOf ~/appointment/appointment.tar blobs/sha256/47e1a0bb67bcb9c171794640f4017db141d486dab6473d3827933aa7eaf22a66 | tar -x -C ~/nodecheck usr/local/bin/node
```

**Step 4: Check the version.** You can run the binary:
```bash
~/nodecheck/usr/local/bin/node --version
```
Or, without running it, read the version text inside the file:
```bash
strings ~/nodecheck/usr/local/bin/node | grep -oE 'nodejs.org/download/release/v[0-9.]+' | sort -u
```

**Step 5: Clean up**
```bash
rm -rf ~/nodecheck
```

**Which to use:** Method A is shorter and checks the image exactly the way it will run. Method B avoids loading 590 MB into Docker, which is useful on a production host where you don't want to add images.