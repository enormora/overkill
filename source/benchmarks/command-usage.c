#define _DEFAULT_SOURCE
#define _DARWIN_C_SOURCE
#include <errno.h>
#include <inttypes.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>

extern char **environ;

static int64_t microseconds(struct timeval time) {
    return (int64_t)time.tv_sec * 1000000 + time.tv_usec;
}

struct process_reading {
    long pid;
    long parent;
    int64_t resident_kib;
    bool selected;
};

static int64_t sample_resident_set(pid_t root) {
    FILE *rows = popen("/bin/ps -axo pid=,ppid=,rss=", "r");
    if (rows == NULL) {
        return -1;
    }
    struct process_reading *processes = NULL;
    struct process_reading reading;
    size_t count = 0, capacity = 0;
    while (fscanf(rows, "%ld %ld %" SCNd64, &reading.pid, &reading.parent, &reading.resident_kib) == 3) {
        if (count == capacity) {
            capacity = capacity == 0 ? 128 : capacity * 2;
            void *resized = realloc(processes, capacity * sizeof(*processes));
            if (resized == NULL) {
                free(processes);
                pclose(rows);
                return -1;
            }
            processes = resized;
        }
        reading.selected = reading.pid == root;
        processes[count++] = reading;
    }
    if (pclose(rows) != 0) {
        free(processes);
        return -1;
    }
    bool changed;
    do {
        changed = false;
        for (size_t candidate = 0; candidate < count; candidate++) {
            if (processes[candidate].selected) {
                continue;
            }
            for (size_t parent = 0; parent < count; parent++) {
                if (processes[parent].selected && processes[candidate].parent == processes[parent].pid) {
                    processes[candidate].selected = true;
                    changed = true;
                    break;
                }
            }
        }
    } while (changed);
    int64_t total = 0;
    for (size_t index = 0; index < count; index++) {
        if (processes[index].selected) {
            total += processes[index].resident_kib;
        }
    }
    free(processes);
    return total * 1024;
}

static pid_t wait_for_command(pid_t child, int *status, struct rusage *usage, int64_t *peak) {
    if (peak == NULL) {
        pid_t waited;
        do {
            waited = wait4(child, status, 0, usage);
        } while (waited < 0 && errno == EINTR);
        return waited;
    }
    for (;;) {
        pid_t waited = wait4(child, status, WNOHANG, usage);
        if (waited < 0 && errno == EINTR) {
            continue;
        }
        if (waited != 0) {
            return waited;
        }
        int64_t observed = sample_resident_set(child);
        if (observed > *peak) {
            *peak = observed;
        }
        const struct timespec interval = { 0, 25000000 };
        nanosleep(&interval, NULL);
    }
}

int main(int argc, char **argv) {
    if (argc < 2) {
        return 2;
    }

    bool sample_resident = strcmp(argv[1], "--sample-resident") == 0;
    int command = sample_resident ? 2 : 1;
    if (argc <= command) {
        return 2;
    }
    struct timespec start, end;
    pid_t child;
    int status;
    struct rusage usage;
    if (clock_gettime(CLOCK_MONOTONIC, &start) != 0) {
        return 2;
    }
    int error = posix_spawn(&child, argv[command], NULL, NULL, &argv[command], environ);
    if (error != 0) {
        fprintf(stderr, "Cannot launch benchmark command: %s\n", strerror(error));
        return 2;
    }
    int64_t sampled_peak = 0;
    pid_t waited = wait_for_command(child, &status, &usage, sample_resident ? &sampled_peak : NULL);
    if (waited != child || clock_gettime(CLOCK_MONOTONIC, &end) != 0) {
        return 2;
    }
    if (!WIFEXITED(status)) {
        return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 2;
    }

    if (sample_resident && sampled_peak == 0) {
        fprintf(stderr, "No process-tree resident set observations\n");
        return 2;
    }
    int64_t peak_bytes = usage.ru_maxrss;
#ifdef __linux__
    peak_bytes *= 1024;
#endif
    int64_t elapsed = ((int64_t)end.tv_sec - start.tv_sec) * 1000000 +
        (end.tv_nsec - start.tv_nsec) / 1000;
    fprintf(stderr, "overkill-command-usage {\"wallMicroseconds\":%" PRId64
        ",\"userMicroseconds\":%" PRId64 ",\"systemMicroseconds\":%" PRId64
        ",\"peakResidentBytes\":%" PRId64 ",\"sampledResidentBytes\":%" PRId64 "}\n",
        elapsed, microseconds(usage.ru_utime), microseconds(usage.ru_stime), peak_bytes, sampled_peak);
    return WEXITSTATUS(status);
}
