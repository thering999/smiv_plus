</main>
<script>
document.addEventListener('click', function (e) {
    document.querySelectorAll('.nav-dropdown.open').forEach(d => {
        if (!d.contains(e.target)) d.classList.remove('open');
    });
});
</script>
</body>
</html>
